import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { logger } from "../util/logger.js";
import { eventBus } from "../util/eventBus.js";
import { upsertChat, bumpChatActivity, incUnread } from "../db/repos/chats.js";
import { insertMessage } from "../db/repos/messages.js";
import { isBlocked } from "../db/repos/rules.js";
import { getSettings } from "../db/repos/settings.js";
import { generateAndReply } from "../ai/responder.js";
import { sendReaction } from "./sender.js";
import { tryDispatchSlash } from "./slashDispatch.js";

export function initRouter(client: TelegramClient): void {
  client.addEventHandler(async (event: NewMessageEvent) => {
    try {
      await handle(event);
    } catch (err) {
      logger.error("router error", { err: err instanceof Error ? err.message : String(err) });
    }
  }, new NewMessage({}));

  logger.info("router ready");
}

async function handle(event: NewMessageEvent): Promise<void> {
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
      tgChatId = msg.chatId!.toString();
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
    return;
  }

  const blocked = dbChat.is_blocked || (await isBlocked({ username, tg_chat_id: tgChatId }));
  if (blocked) {
    logger.info("incoming message blocked", { chat_id: dbChat.id });
    return;
  }

  if (!settings.auto_reply_enabled) {
    logger.info("auto-reply disabled, skipping", { chat_id: dbChat.id });
    return;
  }

  if (text.startsWith("/")) {
    const result = await tryDispatchSlash(updatedChat, text, msg.id);
    if (result.handled) {
      if (result.type !== "ai_prompt" && result.type !== "noop" && settings.reaction_done && msg.id) {
        await sendReaction(tgChatId, msg.id, settings.reaction_done);
      }
      return;
    }
  }

  if (settings.reaction_thinking) {
    await sendReaction(tgChatId, msg.id, settings.reaction_thinking);
  }

  await generateAndReply(updatedChat, text, msg.id);
}
