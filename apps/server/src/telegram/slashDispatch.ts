import { spawn } from "node:child_process";
import type { Chat, SlashCommandType } from "@tele/shared";
import { getSlashCommandByName } from "../db/repos/slashCommands.js";
import { sendReply } from "./sender.js";
import { generateAndReply } from "../ai/responder.js";
import { logger } from "../util/logger.js";

const SHELL_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 3500;

function truncate(s: string): string {
  if (s.length <= OUTPUT_LIMIT) return s;
  return s.slice(0, OUTPUT_LIMIT) + "... [truncated]";
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

  const row = await getSlashCommandByName(name);
  if (!row) {
    logger.info("slash command not found, falling through to AI", { name, chat: chat.id });
    return { handled: false };
  }
  if (!row.enabled) {
    logger.info("slash command disabled, falling through", { name, chat: chat.id });
    return { handled: false };
  }

  const action = row.action.replaceAll("{args}", args ?? "");

  if (row.type === "message") {
    await sendReply(chat, action, "ai");
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
    return { handled: true, type: "shell" };
  }

  if (row.type === "ai_prompt") {
    await generateAndReply(chat, args ?? "", incomingTgMsgId, {
      systemInstructionOverride: action,
    });
    return { handled: true, type: "ai_prompt" };
  }

  if (row.type === "noop") {
    logger.info("slash command noop, silently ignoring", { name, chat: chat.id });
    return { handled: true, type: "noop" };
  }

  return { handled: false };
}
