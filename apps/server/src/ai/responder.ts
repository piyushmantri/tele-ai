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
import { logger } from "../util/logger.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

export async function generateAndReply(
  chat: Chat,
  latestUserText: string,
  incomingTgMsgId?: number,
  opts?: { systemInstructionOverride?: string },
): Promise<void> {
  const settings = await getSettings();
  const history = await getRecentForAi(chat.id, 20);
  const prefix = settings.bot_prefix?.trim();

  const contents: Content[] = history.map((m) => {
    let text = m.text;
    if (m.direction === "out" && prefix && text.startsWith(prefix)) {
      text = text.slice(prefix.length).trimStart();
    }
    return { role: m.direction === "in" ? "user" : "model", parts: [{ text }] };
  });

  if (contents.length === 0 || contents[contents.length - 1]?.role !== "user") {
    contents.push({ role: "user", parts: [{ text: latestUserText }] });
  }

  const { tools, registry, summary } = await buildTools(chat.id, chat.tg_chat_id);
  const systemInstruction =
    opts?.systemInstructionOverride ??
    buildSystemInstruction({
      chat,
      settings,
      toolsSummary: summary,
    });

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
    logger.error("ai loop failed", {
      chat: chat.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!text) return;
  const finalText = prefix ? `${prefix} ${text}` : text;
  await sendReply(chat, finalText, "ai");
  if (settings.reaction_done && incomingTgMsgId) {
    await sendReaction(chat.tg_chat_id, incomingTgMsgId, settings.reaction_done);
  }
}
