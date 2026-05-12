import { Api } from "telegram";
import type { NewMessageEvent } from "telegram/events/index.js";
import type { CallbackQueryEvent } from "telegram/events/CallbackQuery.js";
import { upsertChat, bumpChatActivity, incUnread, setChatBlocked, getChatById } from "../db/repos/chats.js";
import { insertMessage } from "../db/repos/messages.js";
import { getTelegramBotConfig } from "../db/repos/telegramBotConfig.js";
import { getSettings } from "../db/repos/settings.js";
import { consumePendingChoice } from "../db/repos/pendingChoices.js";
import { eventBus } from "../util/eventBus.js";
import { logger } from "../util/logger.js";
import { generateAndReply } from "./responder.js";
import { makeBotReplyAdapter } from "../telegram/botSender.js";
import { getBotClient } from "../telegram/botClient.js";
import { tryUnblockCommand } from "../telegram/unblockCommand.js";
import { tryDispatchSlash } from "../telegram/slashDispatch.js";
import { incCounter } from "../util/metrics.js";

export async function handleBotMessage(event: NewMessageEvent): Promise<void> {
  // Pre-pipeline gate ordering (lessons-2026-05-08), mirroring router.ts:
  //   1) bot config / out-skip / sender resolution (anti-loop equivalents)
  //   2) tryUnblockCommand     — operator must be able to /unblock even on blocked chats
  //   3) slash-only gate       — drop non-/ plain text; /-prefixed survives
  //   4) is_blocked check      — authz deny
  //   5) tryDispatchSlash      — built-in /context, /slash-only, /delete, /block + user slashes
  //   6) generateAndReply (AI)
  try {
    const cfg = await getTelegramBotConfig();
    if (!cfg?.enabled) return;
    const msg = event.message;
    if (msg.out) return;
    const sender = await msg.getSender();
    if (!sender || !(sender instanceof Api.User)) return;
    const userText = msg.message ?? "";
    if (!userText) return;
    incCounter("bot.message_received");

    const tgChatId = String(sender.id);
    const dbChat = await upsertChat({
      tg_chat_id: tgChatId,
      username: sender.username ?? null,
      first_name: sender.firstName ?? null,
      last_name: sender.lastName ?? null,
      chat_type: "bot",
    });

    const inserted = await insertMessage({
      chat_id: dbChat.id,
      tg_message_id: String(msg.id),
      direction: "in",
      text: userText,
      source: "user",
    });

    await incUnread(dbChat.id);
    const updatedChat = await bumpChatActivity(dbChat.id, new Date());
    eventBus.emit({ type: "message:new", payload: { chat: updatedChat, message: inserted } });

    const settings = await getSettings();
    const unblockResult = tryUnblockCommand(updatedChat, userText, settings);
    if (unblockResult.matched) {
      if (unblockResult.correct) {
        await setChatBlocked(updatedChat.id, false);
        const unblocked = { ...updatedChat, is_blocked: false };
        eventBus.emit({ type: "chat:updated", payload: { chat: unblocked } });
        const client = getBotClient();
        if (client) {
          const confirmation = "Unblocked. Send your message.";
          const sent = await client.sendMessage(Number(tgChatId), { message: confirmation });
          await insertMessage({
            chat_id: dbChat.id,
            tg_message_id: sent.id != null ? String(sent.id) : null,
            direction: "out",
            text: confirmation,
            source: "manual",
          });
        }
      }
      return;
    }
    if (updatedChat.slash_only) {
      if (!userText.startsWith("/")) {
        logger.info("slash_only bot chat: dropping non-slash message", {
          chat_id: dbChat.id,
          preview: userText.slice(0, 60),
        });
        incCounter("bot.slash_only_dropped");
        return;
      }
      // Slash-only bypass: in this mode slash commands always run, even on
      // blocked chats. Operator opted into "this chat speaks slash".
      const result = await tryDispatchSlash(updatedChat, userText, msg.id);
      if (result.handled) {
        incCounter("bot.dispatched.slash");
      }
      return;
    }
    if (updatedChat.is_blocked) {
      logger.info("bot incoming message blocked", { chat_id: dbChat.id });
      return;
    }

    if (userText.startsWith("/")) {
      const result = await tryDispatchSlash(updatedChat, userText, msg.id);
      if (result.handled) {
        incCounter("bot.dispatched.slash");
        return;
      }
    }

    const adapter = makeBotReplyAdapter(tgChatId, dbChat.id);
    await generateAndReply(updatedChat, userText, msg.id, {
      systemInstructionOverride: cfg.system_prompt || undefined,
      replyAdapter: adapter,
      isBot: true,
      botToken: cfg.token,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("handleBotMessage failed", { err: errMsg });
    // Notify the user via the bot — best effort.
    try {
      const sender = await event.message.getSender();
      if (sender && sender instanceof Api.User) {
        const client = getBotClient();
        if (client) {
          await client.sendMessage(Number(sender.id.toString()), {
            message: `Error processing message: ${errMsg.slice(0, 200)}`,
          });
        }
      }
    } catch (notifyErr) {
      logger.warn("failed to notify bot user of error", {
        err: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }
  }
}

export async function handleBotCallback(event: CallbackQueryEvent): Promise<void> {
  try {
    logger.info("handleBotCallback fired", {
      data: event.data ? event.data.toString("utf8") : null,
      messageId: event.messageId != null ? String(event.messageId) : null,
      senderId: event.sender ? String((event.sender as { id?: unknown }).id) : null,
    });
    incCounter("bot.callback_received");
    const cfg = await getTelegramBotConfig();
    if (!cfg?.enabled) return;

    // Fire-and-forget ACK so the spinner clears immediately. Per lessons-2026-05-04 the
    // void prefix and .catch are both load-bearing — never await this.
    void event
      .answer()
      .catch((err) =>
        logger.warn("answer callback failed", {
          err: err instanceof Error ? err.message : String(err),
        }),
      );

    const dataBuf = event.data;
    const callbackData = dataBuf ? dataBuf.toString("utf8") : "";

    // Choice-token branch: ask_user_choice button taps short-circuit the generic
    // [Button: ...] flow so the AI sees a clean [Choice: <label>] turn on the SOURCE
    // chat (which may differ from the callback chat in future). Resolved BEFORE the
    // sender check because choice handling uses the token's source_chat_id, not the
    // callback sender (which may be null for callbacks from groups where the bot
    // lacks a cached user entity).
    const choiceMatch = /^c:([A-Za-z0-9_-]{1,32}):(\d+)$/.exec(callbackData);
    if (choiceMatch) {
      const [, token, idxStr] = choiceMatch;
      const idx = Number(idxStr);
      const claimed = await consumePendingChoice(token!);
      if (!claimed) {
        incCounter("bot.choice_claimed.stale");
        logger.info("pending choice token not claimable", { token });
        return;
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= claimed.options.length) {
        logger.warn("pending choice idx out of range", {
          token,
          idx,
          len: claimed.options.length,
        });
        return;
      }
      const sourceChat = await getChatById(claimed.source_chat_id);
      if (!sourceChat) {
        logger.warn("pending choice source chat missing", {
          token,
          source_chat_id: claimed.source_chat_id,
        });
        return;
      }
      const label = claimed.options[idx]!;
      const syntheticText = `[Choice: ${label}]`;
      incCounter("bot.choice_claimed.ok");
      const insertedChoice = await insertMessage({
        chat_id: sourceChat.id,
        tg_message_id: String(event.messageId),
        direction: "in",
        text: syntheticText,
        source: "user",
      });
      const updatedSource = await bumpChatActivity(sourceChat.id, new Date());
      eventBus.emit({
        type: "message:new",
        payload: { chat: updatedSource, message: insertedChoice },
      });

      // Echo the user's selection as a visible text message in the delivery chat
      // so chat members see what was picked. For shared chats (group/channel) the
      // echo is prefixed with bot_prefix so the userbot router skips it (otherwise
      // it would treat the bot's echo as a new user turn).
      try {
        const client = getBotClient();
        if (client) {
          const settings = await getSettings();
          const prefix = settings.bot_prefix?.trim();
          const echoText =
            updatedSource.chat_type === "bot" ? label : prefix ? `${prefix} ${label}` : label;
          await client.sendMessage(Number(updatedSource.tg_chat_id), { message: echoText });
        }
      } catch (err) {
        logger.warn("ask_user_choice echo send failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      if (updatedSource.chat_type === "bot") {
        const adapter = makeBotReplyAdapter(updatedSource.tg_chat_id, updatedSource.id);
        await generateAndReply(updatedSource, syntheticText, event.messageId, {
          systemInstructionOverride: cfg.system_prompt || undefined,
          replyAdapter: adapter,
          isBot: true,
          botToken: cfg.token,
        });
      } else {
        await generateAndReply(updatedSource, syntheticText, event.messageId);
      }
      return;
    }

    const sender = event.sender;
    if (!sender || !(sender instanceof Api.User)) return;

    const tgChatId = String(sender.id);

    const dbChat = await upsertChat({
      tg_chat_id: tgChatId,
      username: sender.username ?? null,
      first_name: sender.firstName ?? null,
      last_name: sender.lastName ?? null,
      chat_type: "bot",
    });

    const syntheticText = `[Button: ${callbackData}]`;
    const inserted = await insertMessage({
      chat_id: dbChat.id,
      tg_message_id: String(event.messageId),
      direction: "in",
      text: syntheticText,
      source: "user",
    });

    await incUnread(dbChat.id);
    const updatedChat = await bumpChatActivity(dbChat.id, new Date());
    eventBus.emit({ type: "message:new", payload: { chat: updatedChat, message: inserted } });

    if (updatedChat.is_blocked) {
      logger.info("bot callback blocked", { chat_id: dbChat.id });
      incCounter("bot.callback_blocked");
      return;
    }

    const adapter = makeBotReplyAdapter(tgChatId, dbChat.id);
    await generateAndReply(updatedChat, syntheticText, event.messageId, {
      systemInstructionOverride: cfg.system_prompt || undefined,
      replyAdapter: adapter,
      isBot: true,
      botToken: cfg.token,
    });
  } catch (err) {
    logger.error("handleBotCallback failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
