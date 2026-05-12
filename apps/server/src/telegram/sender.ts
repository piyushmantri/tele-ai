import { basename, extname } from "node:path";
import { Api, helpers } from "telegram";
import type { Chat } from "@tele/shared";
import { getClient } from "./client.js";
import { insertMessage } from "../db/repos/messages.js";
import { bumpChatActivity, getChatById } from "../db/repos/chats.js";
import { storePoll } from "../db/repos/polls.js";
import { eventBus } from "../util/eventBus.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";

export async function sendReaction(
  tgChatId: string,
  tgMessageId: number,
  emoticon: string,
): Promise<void> {
  if (!emoticon || !tgMessageId) return;
  const client = getClient();
  try {
    await client.invoke(
      new Api.messages.SendReaction({
        peer: Number(tgChatId),
        msgId: tgMessageId,
        reaction: [new Api.ReactionEmoji({ emoticon })],
      }),
    );
    incCounter("sender.reaction.ok");
  } catch (err) {
    incCounter("sender.reaction.err");
    logger.warn("sendReaction failed", { err: err instanceof Error ? err.message : String(err) });
  }
}

export async function sendReply(
  chat: Chat,
  text: string,
  source: "ai" | "manual" = "ai",
): Promise<void> {
  const client = getClient();
  const peer = Number(chat.tg_chat_id);
  let tgMessageId: string | null = null;
  try {
    const sent = await client.sendMessage(peer, { message: text });
    tgMessageId = sent.id != null ? String(sent.id) : null;
  } catch (err) {
    incCounter("sender.message.err");
    logger.error("sendMessage failed", {
      chat: chat.id,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const message = await insertMessage({
    chat_id: chat.id,
    tg_message_id: tgMessageId,
    direction: "out",
    text,
    source,
  });
  const updated = (await getChatById(chat.id)) ?? chat;
  await bumpChatActivity(chat.id, new Date());
  eventBus.emit({ type: "message:sent", payload: { chat: updated, message } });
  incCounter("sender.message.ok");
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);

function mediaLabel(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "Image";
  if (VIDEO_EXTS.has(ext)) return "Video";
  return "File";
}

export async function sendFile(
  chat: Chat,
  filePath: string,
  caption = "",
  source: "ai" | "manual" = "ai",
): Promise<void> {
  const client = getClient();
  const peer = Number(chat.tg_chat_id);
  const fileName = basename(filePath);
  const ext = extname(fileName).toLowerCase();
  const forceDocument = !IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext);
  let tgMessageId: string | null = null;
  try {
    const sent = await client.sendFile(peer, {
      file: filePath,
      caption,
      forceDocument,
      workers: 1,
    });
    tgMessageId = sent.id != null ? String(sent.id) : null;
    logger.info("sendFile ok", { chat: chat.id, file: fileName, forceDocument });
  } catch (err) {
    incCounter("sender.file.err");
    logger.error("sendFile failed", {
      chat: chat.id,
      file: fileName,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const label = mediaLabel(fileName);
  const text = caption ? `[${label}: ${fileName}] ${caption}` : `[${label}: ${fileName}]`;
  const message = await insertMessage({
    chat_id: chat.id,
    tg_message_id: tgMessageId,
    direction: "out",
    text,
    source,
  });
  const updated = (await getChatById(chat.id)) ?? chat;
  await bumpChatActivity(chat.id, new Date());
  eventBus.emit({ type: "message:sent", payload: { chat: updated, message } });
  incCounter("sender.file.ok");
}

export interface SendPollOptions {
  anonymous?: boolean;
  multiple_choice?: boolean;
  quiz_correct_index?: number;
}

function extractMsgId(result: unknown): string | null {
  const r = result as Record<string, unknown>;
  if (r["className"] === "UpdateShortSentMessage" && r["id"]) return String(r["id"]);
  if (Array.isArray(r["updates"])) {
    for (const upd of r["updates"] as Array<Record<string, unknown>>) {
      const cn = upd["className"] as string | undefined;
      if ((cn === "UpdateNewMessage" || cn === "UpdateNewChannelMessage") && upd["message"]) {
        const msg = upd["message"] as Record<string, unknown>;
        if (msg["id"]) return String(msg["id"]);
      }
    }
  }
  return null;
}

export async function sendPoll(
  chat: Chat,
  question: string,
  options: string[],
  opts: SendPollOptions = {},
  source: "ai" | "manual" = "ai",
): Promise<void> {
  const client = getClient();
  const peer = Number(chat.tg_chat_id);
  const anonymous = opts.anonymous ?? true;
  const multipleChoice = opts.multiple_choice ?? false;
  const quizIndex = opts.quiz_correct_index;
  const isQuiz = typeof quizIndex === "number";

  const answers = options.map(
    (opt, i) =>
      new Api.PollAnswer({
        text: new Api.TextWithEntities({ text: opt, entities: [] }),
        option: Buffer.from([i]),
      }),
  );

  const poll = new Api.Poll({
    id: helpers.generateRandomLong(),
    publicVoters: !anonymous,
    multipleChoice: multipleChoice,
    quiz: isQuiz,
    question: new Api.TextWithEntities({ text: question, entities: [] }),
    answers,
  });

  const media = new Api.InputMediaPoll({
    poll,
    correctAnswers: isQuiz ? [Buffer.from([quizIndex as number])] : undefined,
  });

  let tgMsgId: string | null = null;
  try {
    const result = await client.invoke(
      new Api.messages.SendMedia({
        peer,
        media,
        message: "",
        randomId: helpers.generateRandomLong(),
      }),
    );
    tgMsgId = extractMsgId(result);
    logger.info("sendPoll ok", { chat: chat.id, question, options: options.length, quiz: isQuiz, tgMsgId });
  } catch (err) {
    incCounter("sender.poll.err");
    logger.error("sendPoll failed", {
      chat: chat.id,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await storePoll({
    poll_id: poll.id.toString(),
    chat_id: chat.id,
    question,
    options,
    tg_message_id: tgMsgId,
  }).catch(
    (e) => logger.warn("storePoll failed", { err: e instanceof Error ? e.message : String(e) }),
  );

  const text = `[Poll: ${question}] ${options.join(" | ")}`;
  const message = await insertMessage({
    chat_id: chat.id,
    tg_message_id: null,
    direction: "out",
    text,
    source,
  });
  const updated = (await getChatById(chat.id)) ?? chat;
  await bumpChatActivity(chat.id, new Date());
  eventBus.emit({ type: "message:sent", payload: { chat: updated, message } });
  incCounter("sender.poll.ok");
}

