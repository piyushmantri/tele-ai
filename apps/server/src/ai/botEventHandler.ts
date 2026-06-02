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
import { transcribeVoice, MAX_VOICE_DURATION_SEC } from "./voice.js";
import {
  countFiles,
  createFile,
  getApplicationsAssignedToChat,
  saveFileLocally,
} from "../db/repos/applicationFiles.js";

const ALLOWED_MEDIA_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
]);
const MAX_MEDIA_FILE_SIZE = 10 * 1024 * 1024;
const MAX_CHAT_FILES_PER_APP = 20;

// Excludes music (voice falsy) and round-video by construction.
// Inlined per-file (each file self-contained — both files already duplicate the
// media ingestion helper).
function detectVoice(
  media: unknown,
): { mimeType: string; durationSec: number } | null {
  if (!(media instanceof Api.MessageMediaDocument)) return null;
  const doc = media.document;
  if (!(doc instanceof Api.Document)) return null;
  const audioAttr = doc.attributes.find(
    (a): a is Api.DocumentAttributeAudio =>
      a instanceof Api.DocumentAttributeAudio && a.voice === true,
  );
  if (!audioAttr) return null;
  return {
    mimeType: doc.mimeType ?? "audio/ogg",
    durationSec: audioAttr.duration ?? 0,
  };
}

async function handleBotMediaIngestion(
  event: NewMessageEvent,
  dbChatId: string,
  tgChatId: string,
): Promise<void> {
  const client = getBotClient();
  if (!client) return;
  const msg = event.message;
  const media = msg.media;
  if (!media) return;

  let mimeType: string;
  let filename: string;

  if (media instanceof Api.MessageMediaPhoto) {
    mimeType = "image/jpeg";
    filename = `photo_${msg.id}.jpg`;
  } else if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (!(doc instanceof Api.Document)) return;
    mimeType = doc.mimeType || "application/octet-stream";
    const nameAttr = doc.attributes.find((a) => a instanceof Api.DocumentAttributeFilename);
    filename =
      nameAttr instanceof Api.DocumentAttributeFilename
        ? nameAttr.fileName
        : `document_${msg.id}`;
  } else {
    return;
  }

  const reply = async (text: string) => {
    await client.sendMessage(Number(tgChatId), { message: text });
  };

  if (!ALLOWED_MEDIA_MIMES.has(mimeType)) {
    await reply(`Unsupported file type: ${mimeType}. Supported: images, PDF, text/markdown/csv.`);
    return;
  }

  const apps = await getApplicationsAssignedToChat(dbChatId);
  if (apps.length === 0) {
    await reply("No application is assigned to this chat. Assign one in the dashboard first.");
    return;
  }
  if (apps.length > 1) {
    await reply("Multiple applications are active for this chat. Upload files from the dashboard instead.");
    return;
  }

  const app = apps[0]!;
  const count = await countFiles(app.id, dbChatId);
  if (count >= MAX_CHAT_FILES_PER_APP) {
    await reply(`Knowledge base for this chat already has ${MAX_CHAT_FILES_PER_APP} files (limit reached).`);
    return;
  }

  const buf = await client.downloadMedia(media, { outputFile: Buffer.alloc(0) });
  if (!(buf instanceof Buffer)) {
    logger.warn("bot downloadMedia returned non-Buffer", { chatId: dbChatId });
    return;
  }
  if (buf.byteLength > MAX_MEDIA_FILE_SIZE) {
    await reply("File exceeds 10 MB limit.");
    return;
  }

  const localPath = await saveFileLocally(app.id, dbChatId, filename, buf);
  await createFile({
    applicationId: app.id,
    chatId: dbChatId,
    filename,
    mimeType,
    sizeBytes: buf.byteLength,
    localPath,
  });

  await reply(`Added **${filename}** to *${app.name}* knowledge base for this chat.`);
  incCounter("media_ingestion.bot.success");
  logger.info("bot media ingested into application KB", { appId: app.id, chatId: dbChatId, filename });
}

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
    const tgChatId = String(sender.id);
    let userText = msg.message ?? "";
    let isVoiceTurn = false;

    // Voice ingestion runs BEFORE handleBotMediaIngestion (lessons-2026-05-08
    // pre-pipeline ordering); fall through sets userText so the
    // `if (!userText) return;` guard below is bypassed.
    if (msg.media) {
      const v = detectVoice(msg.media);
      if (v) {
        const client = getBotClient();
        if (!client) return;
        if (v.durationSec > MAX_VOICE_DURATION_SEC) {
          await client.sendMessage(Number(tgChatId), {
            message: `Voice message too long (${Math.round(v.durationSec)}s). Max ${MAX_VOICE_DURATION_SEC}s.`,
          });
          incCounter("bot.voice.too_long");
          return;
        }
        const dbChat = await upsertChat({
          tg_chat_id: tgChatId,
          username: sender.username ?? null,
          first_name: sender.firstName ?? null,
          last_name: sender.lastName ?? null,
          chat_type: "bot",
        });
        let buf: Buffer;
        try {
          const dl = await client.downloadMedia(msg.media, {});
          if (!(dl instanceof Buffer)) {
            throw new Error("downloadMedia returned non-Buffer");
          }
          if (dl.byteLength > MAX_MEDIA_FILE_SIZE) {
            await client.sendMessage(Number(tgChatId), {
              message: "Voice message exceeds 10 MB limit.",
            });
            incCounter("bot.voice.too_big");
            return;
          }
          buf = dl;
        } catch (err) {
          logger.warn("bot voice download failed", {
            chat_id: dbChat.id,
            err: err instanceof Error ? err.message : String(err),
          });
          await client.sendMessage(Number(tgChatId), {
            message: "Couldn't download voice message.",
          });
          incCounter("bot.voice.download_err");
          return;
        }
        let transcript: string;
        try {
          transcript = await transcribeVoice(buf, v.mimeType);
        } catch (err) {
          logger.warn("bot voice transcription failed", {
            chat_id: dbChat.id,
            err: err instanceof Error ? err.message : String(err),
          });
          await client.sendMessage(Number(tgChatId), {
            message: "Couldn't transcribe voice message.",
          });
          incCounter("bot.voice.transcribe_err");
          return;
        }
        if (!transcript.trim()) {
          await client.sendMessage(Number(tgChatId), {
            message: "Voice message was empty.",
          });
          incCounter("bot.voice.empty");
          return;
        }
        userText = `[Voice]: ${transcript.trim()}`;
        isVoiceTurn = true;
        incCounter("bot.voice.ok");
        // FALL THROUGH — the `if (!userText) return;` guard below is now bypassed.
      }
    }

    // Media ingestion — runs before the text guard
    if (msg.media && !userText) {
      const dbChat = await upsertChat({
        tg_chat_id: tgChatId,
        username: sender.username ?? null,
        first_name: sender.firstName ?? null,
        last_name: sender.lastName ?? null,
        chat_type: "bot",
      });
      await handleBotMediaIngestion(event, dbChat.id, tgChatId);
      return;
    }
    if (msg.media && userText) {
      const dbChat = await upsertChat({
        tg_chat_id: tgChatId,
        username: sender.username ?? null,
        first_name: sender.firstName ?? null,
        last_name: sender.lastName ?? null,
        chat_type: "bot",
      });
      handleBotMediaIngestion(event, dbChat.id, tgChatId).catch((err) =>
        logger.warn("bot media ingestion error", { err: err instanceof Error ? err.message : String(err) }),
      );
      // fall through to process caption text
    }

    if (!userText) return;
    incCounter("bot.message_received");

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
      voiceReply: isVoiceTurn,
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
