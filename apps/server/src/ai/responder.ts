import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content } from "@google/generative-ai";
import type { Chat } from "@tele/shared";
import { config } from "../config.js";
import { getRecentForAi } from "../db/repos/messages.js";
import { getSettings } from "../db/repos/settings.js";
import { buildSystemInstruction } from "./systemPrompt.js";
import { buildTools, runToolLoop } from "./tools/index.js";
import { sendReply } from "../telegram/sender.js";
import { sendReaction } from "../telegram/sender.js";
import type { ReplyAdapter } from "../telegram/botSender.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

export async function generateAndReply(
  chat: Chat,
  latestUserText: string,
  incomingTgMsgId?: number,
  opts?: {
    systemInstructionOverride?: string;
    replyAdapter?: ReplyAdapter;
    isBot?: boolean;
    botToken?: string;
  },
): Promise<void> {
  const settings = await getSettings();
  const history = await getRecentForAi(chat.id, 20);
  const prefix = settings.bot_prefix?.trim();

  const contents: Content[] = history.map((m) => {
    let text = m.text;
    if (m.direction === "out") {
      // Strip any leading prefix marker (current bot_prefix OR legacy bracket tags
      // like [Woody] OR leading emoji prefix). Past messages may have been saved
      // with a different prefix; without stripping them the AI mimics the stale
      // prefix in new replies.
      let prev: string;
      do {
        prev = text;
        text = text.replace(/^(\[[^\]]+\]|\p{Extended_Pictographic}+)\s+/u, "");
      } while (text !== prev);
    }
    return { role: m.direction === "in" ? "user" : "model", parts: [{ text }] };
  });

  if (contents.length === 0 || contents[contents.length - 1]?.role !== "user") {
    contents.push({ role: "user", parts: [{ text: latestUserText }] });
  }

  const { tools, registry, summary } = await buildTools(chat.id, chat.tg_chat_id, {
    isBot: opts?.isBot,
    botToken: opts?.botToken,
    chatType: chat.chat_type,
  });
  const baseInstruction =
    opts?.systemInstructionOverride ??
    buildSystemInstruction({
      chat,
      settings,
      toolsSummary: summary,
    });
  const ctx = chat.ai_context?.trim();
  const systemInstruction = ctx
    ? `${baseInstruction}\n\n--- Chat-specific context ---\n${ctx}`
    : baseInstruction;

  const model = genAI.getGenerativeModel({
    model: settings.gemini_model || config.GEMINI_MODEL,
    systemInstruction,
    tools,
    generationConfig: { temperature: settings.temperature },
  });

  if (settings.reply_delay_ms > 0) {
    await new Promise((r) => setTimeout(r, settings.reply_delay_ms));
  }

  logger.info("calling gemini", { chat: chat.id, model: settings.gemini_model, messages: contents.length });

  let text: string;
  try {
    text = await runToolLoop({ model, contents, registry, chatId: chat.id });
    logger.info("gemini replied", { chat: chat.id, length: text.length });
  } catch (err) {
    incCounter("responder.error");
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ai loop failed", { chat: chat.id, err: msg });
    // Communicate the failure to the user so they aren't left hanging.
    const errText = `AI failed: ${msg.slice(0, 200)}`;
    try {
      if (opts?.replyAdapter) {
        await opts.replyAdapter.sendText(errText);
        await opts.replyAdapter.persistOutbound(errText, null);
      } else {
        await sendReply(chat, errText, "manual");
      }
    } catch (notifyErr) {
      logger.warn("failed to notify user of ai error", {
        err: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }
    return;
  }

  if (!text) {
    incCounter("responder.empty_reply_skipped");
    return;
  }
  const finalText = prefix && !opts?.replyAdapter ? `${prefix} ${text}` : text;
  if (opts?.replyAdapter) {
    const { message_id } = await opts.replyAdapter.sendText(finalText);
    await opts.replyAdapter.persistOutbound(finalText, message_id);
  } else {
    await sendReply(chat, finalText, "ai");
    if (settings.reaction_done && incomingTgMsgId) {
      await sendReaction(chat.tg_chat_id, incomingTgMsgId, settings.reaction_done);
    }
  }
  incCounter("responder.reply_sent");
}
