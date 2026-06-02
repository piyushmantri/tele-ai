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
import { tmpdir } from "os";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { sendReaction, sendReply } from "./sender.js";
import { tryDispatchSlash } from "./slashDispatch.js";
import { tryUnblockCommand } from "./unblockCommand.js";
import { incCounter } from "../util/metrics.js";
import { getClient } from "./client.js";
import { transcribeVoice, MAX_VOICE_DURATION_SEC } from "../ai/voice.js";
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
const MAX_MEDIA_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CHAT_FILES_PER_APP = 20;

// Excludes music (voice falsy) and round-video by construction.
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


async function handleMediaIngestion(
  msg: NewMessageEvent["message"],
  dbChatId: string,
): Promise<void> {
  const client = getClient();
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
    return; // unsupported media type (sticker, voice, etc.)
  }

  if (!ALLOWED_MEDIA_MIMES.has(mimeType)) {
    await client.sendMessage(msg.peerId!, {
      message: `Unsupported file type: ${mimeType}. Supported: images, PDF, text/markdown/csv.`,
      replyTo: msg.id,
    });
    return;
  }

  const apps = await getApplicationsAssignedToChat(dbChatId);
  if (apps.length === 0) {
    await client.sendMessage(msg.peerId!, {
      message:
        "No application is assigned to this chat. Assign one in the dashboard first.",
      replyTo: msg.id,
    });
    return;
  }
  if (apps.length > 1) {
    await client.sendMessage(msg.peerId!, {
      message:
        "Multiple applications are active for this chat. Upload files from the dashboard instead.",
      replyTo: msg.id,
    });
    return;
  }

  const app = apps[0]!;
  const count = await countFiles(app.id, dbChatId);
  if (count >= MAX_CHAT_FILES_PER_APP) {
    await client.sendMessage(msg.peerId!, {
      message: `Knowledge base for this chat already has ${MAX_CHAT_FILES_PER_APP} files (limit reached).`,
      replyTo: msg.id,
    });
    return;
  }

  const buf = await client.downloadMedia(media, { outputFile: Buffer.alloc(0) });
  if (!(buf instanceof Buffer)) {
    logger.warn("downloadMedia returned non-Buffer", { chatId: dbChatId });
    return;
  }
  if (buf.byteLength > MAX_MEDIA_FILE_SIZE) {
    await client.sendMessage(msg.peerId!, {
      message: "File exceeds 10 MB limit.",
      replyTo: msg.id,
    });
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

  await client.sendMessage(msg.peerId!, {
    message: `Added **${filename}** to *${app.name}* knowledge base for this chat.`,
    replyTo: msg.id,
  });
  incCounter("media_ingestion.success");
  logger.info("media ingested into application KB", { appId: app.id, chatId: dbChatId, filename });
}

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
  logger.info("handle() called", { out: msg.out, isPrivate: msg.isPrivate, isGroup: msg.isGroup, isChannel: msg.isChannel, hasMedia: msg.media != null, mediaClass: msg.media?.className, text: msg.message?.slice(0, 40) });

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
  let text = msg.message ?? "";
  let isVoiceTurn = false;

  // Voice ingestion runs BEFORE handleMediaIngestion (lessons-2026-05-08
  // pre-pipeline ordering) — otherwise the `else { return; }` swallow in
  // handleMediaIngestion at the unsupported-media branch would kill the voice.
  if (msg.media) {
    logger.info("media message received", {
      mediaClass: msg.media.className,
      hasDocument: (msg.media as any)?.document != null,
      docClass: (msg.media as any)?.document?.className,
      attrs: (msg.media as any)?.document?.attributes?.map((a: any) => ({
        cls: a.className,
        voice: a.voice,
      })),
    });
    const v = detectVoice(msg.media);
    if (v) {
      const client = getClient();
      if (v.durationSec > MAX_VOICE_DURATION_SEC) {
        await client.sendMessage(msg.peerId!, {
          message: `Voice message too long (${Math.round(v.durationSec)}s). Max ${MAX_VOICE_DURATION_SEC}s.`,
          replyTo: msg.id,
        });
        incCounter("router.voice.too_long");
        return;
      }
      const dbChat = await upsertChat({ tg_chat_id: tgChatId, username, first_name: firstName, last_name: lastName, chat_type: chatType });
      let buf: Buffer;
      try {
        const tmpPath = join(tmpdir(), `voice_${Date.now()}_${randomBytes(4).toString("hex")}.tmp`);
        try {
          await client.downloadMedia(msg as any, { outputFile: tmpPath });
          buf = await readFile(tmpPath);
        } finally {
          unlink(tmpPath).catch(() => {});
        }
        if (buf.byteLength > MAX_MEDIA_FILE_SIZE) {
          await client.sendMessage(msg.peerId!, {
            message: "Voice message exceeds 10 MB limit.",
            replyTo: msg.id,
          });
          incCounter("router.voice.too_big");
          return;
        }
      } catch (err) {
        logger.warn("voice download failed", {
          chat_id: dbChat.id,
          err: err instanceof Error ? err.message : String(err),
        });
        await client.sendMessage(msg.peerId!, {
          message: "Couldn't download voice message.",
          replyTo: msg.id,
        });
        incCounter("router.voice.download_err");
        return;
      }
      let transcript: string;
      try {
        transcript = await transcribeVoice(buf, v.mimeType);
      } catch (err) {
        logger.warn("voice transcription failed", {
          chat_id: dbChat.id,
          err: err instanceof Error ? err.message : String(err),
        });
        await client.sendMessage(msg.peerId!, {
          message: "Couldn't transcribe voice message.",
          replyTo: msg.id,
        });
        incCounter("router.voice.transcribe_err");
        return;
      }
      if (!transcript.trim()) {
        await client.sendMessage(msg.peerId!, {
          message: "Voice message was empty.",
          replyTo: msg.id,
        });
        incCounter("router.voice.empty");
        return;
      }
      text = `[Voice]: ${transcript.trim()}`;
      isVoiceTurn = true;
      incCounter("router.voice.ok");
      // FALL THROUGH to normal text-handling path below.
    }
  }

  // Handle media ingestion (inbound only; outbound media = sent file, not an upload request)
  if (!msg.out && msg.media && !text) {
    // Must upsert the chat first so we have a DB id for the FK
    const dbChat = await upsertChat({ tg_chat_id: tgChatId, username, first_name: firstName, last_name: lastName, chat_type: chatType });
    await handleMediaIngestion(msg, dbChat.id);
    return;
  }
  if (!msg.out && msg.media && text) {
    // Caption present — ingest file silently, then continue to process caption as text
    const dbChat = await upsertChat({ tg_chat_id: tgChatId, username, first_name: firstName, last_name: lastName, chat_type: chatType });
    handleMediaIngestion(msg, dbChat.id).catch((err) =>
      logger.warn("media ingestion error", { err: err instanceof Error ? err.message : String(err) }),
    );
    // fall through to normal text processing below
  }

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

  // Voice-triggered messages have `[Voice]:` prefix → never match `/`;
  // documented limitation AC10.
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
  await generateAndReply(updatedChat, text, msg.id, { voiceReply: isVoiceTurn });
}
