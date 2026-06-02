import { spawn } from "node:child_process";
import type { Chat, SlashCommandType } from "@tele/shared";
import { getSlashCommandByName } from "../db/repos/slashCommands.js";
import { sendReply } from "./sender.js";
import { generateAndReply } from "../ai/responder.js";
import { tryApplicationSlashCommand } from "../ai/applicationSlash.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";
import { deleteChat, setChatBlocked, setChatAiContext, setChatSlashOnly } from "../db/repos/chats.js";
import { eventBus } from "../util/eventBus.js";
import { getBotClient } from "./botClient.js";
import { insertMessage } from "../db/repos/messages.js";

const SHELL_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 3500;

function truncate(s: string): string {
  if (s.length <= OUTPUT_LIMIT) return s;
  return s.slice(0, OUTPUT_LIMIT) + "... [truncated]";
}

// Cross-channel reply helper. Bot chats use the bot client (user-account
// client cannot DM the bot's user); other chat types use sendReply, which
// routes via the user-account client.
async function replyToChat(chat: Chat, text: string): Promise<void> {
  if (chat.chat_type === "bot") {
    const client = getBotClient();
    if (!client) {
      logger.warn("bot client unavailable for slash reply", { chat_id: chat.id });
      return;
    }
    const sent = await client.sendMessage(Number(chat.tg_chat_id), { message: text });
    await insertMessage({
      chat_id: chat.id,
      tg_message_id: sent.id != null ? String(sent.id) : null,
      direction: "out",
      text,
      source: "ai",
    });
  } else {
    await sendReply(chat, text, "ai");
  }
}

interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runShell(cmd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn("zsh", ["-c", cmd]);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, SHELL_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + err.message, timedOut });
    });
  });
}

export async function tryDispatchSlash(
  chat: Chat,
  text: string,
  incomingTgMsgId: number,
): Promise<{ handled: boolean; type?: SlashCommandType }> {
  if (!text.startsWith("/")) return { handled: false };

  const m = text.slice(1).match(/^([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return { handled: false };

  const name = m[1]!.toLowerCase();
  const args = m[2];

  // Built-in /delete: deletes the current chat from the DB. Cascades remove messages,
  // pending_choices, polls, scheduled_tasks via FK ON DELETE CASCADE. Instant — no
  // confirmation in the chat itself (operator-only since unblocked chats are operator-trusted).
  if (name === "delete") {
    await deleteChat(chat.id);
    eventBus.emit({ type: "chat:deleted", payload: { chat_id: chat.id } });
    logger.info("chat deleted via /delete slash", { chat_id: chat.id });
    incCounter("slash.dispatched.delete");
    return { handled: true, type: "noop" };
  }

  // Built-in /block: blocks the current chat (sets is_blocked=true). Subsequent
  // messages from the chat are dropped at the router blocked check until /unblock
  // <ai_username> is sent. Instant.
  if (name === "block") {
    await setChatBlocked(chat.id, true);
    const blocked = { ...chat, is_blocked: true };
    eventBus.emit({ type: "chat:updated", payload: { chat: blocked } });
    logger.info("chat blocked via /block slash", { chat_id: chat.id });
    incCounter("slash.dispatched.block");
    return { handled: true, type: "noop" };
  }

  // Built-in /context: manages per-chat AI context (appended to system instruction).
  //   /context           → reply with current value
  //   /context <text>    → set
  //   /context clear     → null out
  if (name === "context") {
    if (!args || args.trim() === "") {
      const cur = chat.ai_context?.trim() || "(no context set)";
      await replyToChat(chat, `Current chat context:\n${cur}`);
      incCounter("slash.dispatched.context.show");
      return { handled: true, type: "noop" };
    }
    if (args.trim().toLowerCase() === "clear") {
      await setChatAiContext(chat.id, null);
      const updated = { ...chat, ai_context: null };
      eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
      await replyToChat(chat, "Chat context cleared.");
      incCounter("slash.dispatched.context.clear");
      return { handled: true, type: "noop" };
    }
    const newContext = args.trim();
    await setChatAiContext(chat.id, newContext);
    const updated = { ...chat, ai_context: newContext };
    eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
    await replyToChat(chat, "Chat context updated.");
    incCounter("slash.dispatched.context.set");
    return { handled: true, type: "noop" };
  }

  // Built-in /slash-only: toggles slash-only mode for the current chat.
  //   /slash-only        → reply with current state
  //   /slash-only on|off → set
  if (name === "slash-only" || name === "slashonly") {
    const sub = args?.trim().toLowerCase() ?? "";
    if (sub !== "on" && sub !== "off") {
      const cur = chat.slash_only ? "on" : "off";
      await replyToChat(chat, `Slash-only mode is currently ${cur}. Use /slash-only on or /slash-only off.`);
      incCounter("slash.dispatched.slash_only.show");
      return { handled: true, type: "noop" };
    }
    const enable = sub === "on";
    await setChatSlashOnly(chat.id, enable);
    const updated = { ...chat, slash_only: enable };
    eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
    await replyToChat(chat, `Slash-only mode ${enable ? "enabled" : "disabled"}.`);
    incCounter(enable ? "slash.dispatched.slash_only.on" : "slash.dispatched.slash_only.off");
    return { handled: true, type: "noop" };
  }

  // Slash command precedence (first match wins):
  //   1. Built-in commands above (/delete, /block, /context, /slash-only).
  //   2. User-defined `slash_commands` table row (looked up below).
  //   3. Application-defined `slash_commands` from installed-app manifests
  //      (tryApplicationSlashCommand fallback when no user-defined row matches).
  //   4. Not found → "Command not found" reply.
  const row = await getSlashCommandByName(name);
  if (!row) {
    // Application-defined slash commands (lower precedence than built-in
    // + user-defined slashCommands).
    const appResult = await tryApplicationSlashCommand(chat, name, args ?? "");
    if (appResult.handled) {
      await replyToChat(chat, appResult.reply ?? "");
      incCounter("slash.dispatched.application");
      return { handled: true, type: "noop" };
    }
    logger.info("slash command not found", { name, chat: chat.id });
    incCounter("slash.not_found");
    await replyToChat(chat, `Command not found: /${name}`);
    return { handled: true, type: "noop" };
  }
  if (!row.enabled) {
    logger.info("slash command disabled", { name, chat: chat.id });
    incCounter("slash.disabled");
    await replyToChat(chat, `Command /${name} is disabled.`);
    return { handled: true, type: "noop" };
  }

  const action = row.action.replaceAll("{args}", args ?? "");

  if (row.type === "message") {
    await sendReply(chat, action, "ai");
    incCounter("slash.dispatched.message");
    return { handled: true, type: "message" };
  }

  if (row.type === "shell") {
    const result = await runShell(action);
    let reply: string;
    if (result.timedOut) {
      reply = `Command timed out after ${SHELL_TIMEOUT_MS / 1000}s`;
      const tail = truncate(result.stdout || result.stderr);
      if (tail) reply += `\n${tail}`;
    } else if (result.code === 0) {
      reply = truncate(result.stdout) || "(no output)";
    } else {
      reply = `Command failed (exit ${result.code}):\n${truncate(result.stderr || result.stdout)}`;
    }
    await sendReply(chat, reply, "ai");
    incCounter("slash.dispatched.shell");
    return { handled: true, type: "shell" };
  }

  if (row.type === "ai_prompt") {
    incCounter("slash.dispatched.ai_prompt");
    await generateAndReply(chat, args ?? "", incomingTgMsgId, {
      systemInstructionOverride: action,
    });
    return { handled: true, type: "ai_prompt" };
  }

  if (row.type === "noop") {
    logger.info("slash command noop, silently ignoring", { name, chat: chat.id });
    incCounter("slash.dispatched.noop");
    return { handled: true, type: "noop" };
  }

  return { handled: false };
}
