import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { logger } from "../util/logger.js";
import { eventBus } from "../util/eventBus.js";
import { upsertChat, bumpChatActivity, incUnread, setChatBlocked } from "../db/repos/chats.js";
import { insertMessage } from "../db/repos/messages.js";
import { isBlocked } from "../db/repos/rules.js";
import { getSettings } from "../db/repos/settings.js";
import { generateAndReply } from "../ai/responder.js";
import { sendReaction, sendReply } from "./sender.js";
import { tryDispatchSlash } from "./slashDispatch.js";
import { tryUnblockCommand } from "./unblockCommand.js";
import { incCounter } from "../util/metrics.js";

export function initRouter(client: TelegramClient): void {
  client.addEventHandler(async (event: NewMessageEvent) => {
    try {
      await handle(event);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("router error", { err: errMsg });
      // Try to notify the user via the connected client — best effort, must not
      // crash the handler. Use client.sendMessage with the peer rather than
      // event.message.reply() because the latter sometimes fails to attach a
      // client when handle() crashed early.
      try {
        const msg = event.message;
        if (msg && !msg.out && msg.peerId) {
          await client.sendMessage(msg.peerId, {
            message: `Error processing message: ${errMsg.slice(0, 200)}`,
            replyTo: msg.id,
          });
        }
      } catch (notifyErr) {
        logger.warn("failed to notify user of router error", {
          err: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
      }
    }
  }, new NewMessage({}));

  logger.info("router ready");
}

async function handle(event: NewMessageEvent): Promise<void> {
  // Pre-pipeline gate ordering (lessons-2026-05-08):
  //   1) bot_prefix anti-loop  — skip our own outbound echoes
  //   2) tryUnblockCommand     — operator must be able to /unblock even on blocked chats
  //   3) slash-only gate       — drop non-/ plain text; /-prefixed survives
  //   4) is_blocked check      — authz deny
  //   5) auto_reply check
  //   6) tryDispatchSlash + AI
  const msg = event.message;

  // Determine chat type and identifiers
  let chatType: "private" | "group" | "channel";
  let tgChatId: string;
  let username: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  if (msg.isPrivate) {
    chatType = "private";
    if (msg.out) {
      // Outbound DM: resolve the other party via getChat() so we capture their
      // name/username instead of leaving the chat row as id-only.
      const chat = await msg.getChat();
      if (chat instanceof Api.User) {
        tgChatId = chat.id.toString();
        username = chat.username ?? null;
        firstName = chat.firstName ?? null;
        lastName = chat.lastName ?? null;
      } else {
        tgChatId = msg.chatId!.toString();
      }
    } else {
      const sender = await msg.getSender();
      if (!sender || !(sender instanceof Api.User)) return;
      tgChatId = sender.id.toString();
      username = sender.username ?? null;
      firstName = sender.firstName ?? null;
      lastName = sender.lastName ?? null;
    }
  } else if (msg.isGroup) {
    chatType = "group";
    tgChatId = msg.chatId!.toString();
    const chat = await msg.getChat();
    if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
      firstName = chat.title ?? null;
    }
    if (chat instanceof Api.Channel) {
      username = chat.username ?? null;
    }
  } else if (msg.isChannel) {
    chatType = "channel";
    tgChatId = msg.chatId!.toString();
    const chat = await msg.getChat();
    if (chat instanceof Api.Channel) {
      firstName = chat.title ?? null;
      username = chat.username ?? null;
    }
  } else {
    return;
  }

  const direction = msg.out ? "out" : "in";
  const text = msg.message ?? "";

  if (!text) return;

  logger.info("message received", { chatType, direction, tgChatId, preview: text.slice(0, 60) });
  incCounter("router.message_received");

  const dbChat = await upsertChat({ tg_chat_id: tgChatId, username, first_name: firstName, last_name: lastName, chat_type: chatType });
  const inserted = await insertMessage({
    chat_id: dbChat.id,
    tg_message_id: String(msg.id),
    direction,
    text,
    source: msg.out ? "manual" : "user",
  });

  if (!msg.out) await incUnread(dbChat.id);
  const updatedChat = await bumpChatActivity(dbChat.id, new Date());

  eventBus.emit({ type: direction === "in" ? "message:new" : "message:sent", payload: { chat: updatedChat, message: inserted } });

  const settings = await getSettings();

  const prefix = settings.bot_prefix?.trim();
  if (prefix && text.startsWith(prefix)) {
    logger.info("skipping bot-prefixed message to avoid loop", { chat_id: dbChat.id });
    incCounter("router.bot_prefix_skipped");
    return;
  }

  // Unblock check runs for BOTH inbound and outbound — operator may type
  // /unblock from their own userbot account in a blocked chat, which arrives
  // with msg.out=true. The bot_prefix skip above already protects against
  // AI-echo loops, so no outbound guard needed here.
  const unblockResult = tryUnblockCommand(updatedChat, text, settings);
  if (unblockResult.matched) {
    if (unblockResult.correct) {
      incCounter("unblock.matched.correct");
      await setChatBlocked(updatedChat.id, false);
      const unblocked = { ...updatedChat, is_blocked: false };
      eventBus.emit({ type: "chat:updated", payload: { chat: unblocked } });
      await sendReply(unblocked, "Unblocked. Send your message.", "manual");
    } else {
      incCounter("unblock.matched.wrong");
    }
    // matched but wrong username → silent drop (do not leak)
    return;
  }

  // Slash-only gate (lessons-2026-05-08): drop non-slash plain text silently.
  // Slash commands ('/'-prefixed) survive and reach the dispatcher below.
  if (updatedChat.slash_only) {
    if (!text.startsWith("/")) {
      logger.info("slash_only chat: dropping non-slash message", {
        chat_id: dbChat.id,
        preview: text.slice(0, 60),
      });
      incCounter("router.slash_only_dropped");
      return;
    }
    // In slash-only mode, slash commands always run — bypass block + auto_reply
    // gates. Operator opted into "this chat speaks slash" so commands take
    // precedence over the chat's other authz state.
    const result = await tryDispatchSlash(updatedChat, text, msg.id);
    if (result.handled) {
      incCounter("router.dispatched.slash");
      if (result.type !== "ai_prompt" && result.type !== "noop" && settings.reaction_done && msg.id) {
        await sendReaction(tgChatId, msg.id, settings.reaction_done);
      }
    } else {
      incCounter("slash.not_found");
    }
    return;
  }

  const blocked = dbChat.is_blocked || (await isBlocked({ username, tg_chat_id: tgChatId }));
  if (blocked) {
    logger.info("incoming message blocked", { chat_id: dbChat.id });
    incCounter("router.blocked");
    return;
  }

  if (!settings.auto_reply_enabled) {
    logger.info("auto-reply disabled, skipping", { chat_id: dbChat.id });
    incCounter("router.auto_reply_disabled");
    return;
  }

  if (text.startsWith("/")) {
    const result = await tryDispatchSlash(updatedChat, text, msg.id);
    if (result.handled) {
      incCounter("router.dispatched.slash");
      if (result.type !== "ai_prompt" && result.type !== "noop" && settings.reaction_done && msg.id) {
        await sendReaction(tgChatId, msg.id, settings.reaction_done);
      }
      return;
    }
  }

  if (settings.reaction_thinking) {
    await sendReaction(tgChatId, msg.id, settings.reaction_thinking);
  }

  incCounter("router.dispatched.ai");
  await generateAndReply(updatedChat, text, msg.id);
}
