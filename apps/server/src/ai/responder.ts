import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content } from "@google/generative-ai";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { Chat } from "@tele/shared";
import { config } from "../config.js";
import { getRecentForAi } from "../db/repos/messages.js";
import { getSettings } from "../db/repos/settings.js";
import { buildSystemInstruction } from "./systemPrompt.js";
import { buildApplicationsContext } from "./applications.js";
import { buildTools, runToolLoop } from "./tools/index.js";
import { sendReply, sendVoice } from "../telegram/sender.js";
import { sendReaction } from "../telegram/sender.js";
import { synthesizeVoice } from "./voice.js";
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
    voiceReply?: boolean;
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

  // Inject send_message tool here so it has closure over chat + replyAdapter.
  // AI uses this to send incremental updates while continuing to work.
  registry.set("send_message", {
    declaration: {
      name: "send_message",
      description:
        "Send an intermediate message to the user immediately. Use this to give incremental updates or partial results while you continue working on a longer task. You can call it multiple times. Do NOT call it for your final reply — just return that as text.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text to send to the user now." },
        },
        required: ["text"],
      },
    },
    handler: async (args: unknown) => {
      const { text: msgText } = args as { text: string };
      if (!msgText?.trim()) return { ok: false, error: "text required" };
      const outText = prefix && !opts?.replyAdapter ? `${prefix} ${msgText}` : msgText;
      try {
        if (opts?.replyAdapter) {
          const { message_id } = await opts.replyAdapter.sendText(outText);
          await opts.replyAdapter.persistOutbound(outText, message_id);
        } else {
          await sendReply(chat, outText, "ai");
        }
        incCounter("responder.send_message_tool");
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
  const firstTool = tools[0] as { functionDeclarations?: Array<unknown> } | undefined;
  firstTool?.functionDeclarations?.push({
    name: "send_message",
    description:
      "Send an intermediate message to the user immediately. Use this to give incremental updates or partial results while you continue working on a longer task. You can call it multiple times. Do NOT call it for your final reply — just return that as text.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message text to send to the user now." },
      },
      required: ["text"],
    } as never,
  });

  const baseInstruction =
    opts?.systemInstructionOverride ??
    buildSystemInstruction({
      chat,
      settings,
      toolsSummary: summary,
    });
  const { text: appsText, fileParts } = await buildApplicationsContext(chat.id);
  const appsBlock = appsText.trim();
  const ctx = chat.ai_context?.trim();
  let systemInstruction = baseInstruction;
  if (appsBlock) {
    systemInstruction = `${systemInstruction}\n\n--- Applications ---\n${appsBlock}`;
  }
  if (ctx) {
    systemInstruction = `${systemInstruction}\n\n--- Chat-specific context ---\n${ctx}`;
  }
  // Always append send_message capability (injected after buildTools, so not in summary)
  systemInstruction = `${systemInstruction}\n\n- send_message: Send an intermediate message to the user right now. Use for incremental updates on long tasks. Call multiple times if needed. Return your FINAL reply as text, not via send_message.`;
  if (opts?.voiceReply) {
    systemInstruction = `${systemInstruction}\n\nIMPORTANT: The user sent a voice message. You are a girl — respond in a warm, natural, feminine speaking style. Use casual feminine expressions, be expressive and conversational. Include emotion markers like [whisper], [excited], [worried], [sad], [laughing], [sighs] naturally within your response — they will be rendered as voice intonation by TTS.`;
  }

  const model = genAI.getGenerativeModel({
    model: settings.gemini_model || config.GEMINI_MODEL,
    systemInstruction,
    tools,
    generationConfig: { temperature: settings.temperature },
  });

  if (fileParts.length > 0) {
    contents.unshift(
      { role: "model", parts: [{ text: "I have reviewed the knowledge base files." }] },
      { role: "user", parts: [{ text: "Knowledge base files:" }, ...fileParts] },
    );
  }

  if (settings.reply_delay_ms > 0) {
    await new Promise((r) => setTimeout(r, settings.reply_delay_ms));
  }

  logger.info("calling gemini", { chat: chat.id, model: settings.gemini_model, messages: contents.length });

  let text: string;
  let repliedViaTools = false;
  try {
    ({ text, repliedViaTools } = await runToolLoop({ model, contents, registry, chatId: chat.id }));
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
    if (!repliedViaTools) {
      const fallback = "Sorry, I wasn't able to find what you were looking for.";
      if (opts?.replyAdapter) {
        await opts.replyAdapter.sendText(fallback);
        await opts.replyAdapter.persistOutbound(fallback, null);
      } else {
        await sendReply(chat, fallback, "ai");
      }
    }
    return;
  }

  if (opts?.voiceReply) {
    try {
      const { buffer, mimeType, durationSec } = await synthesizeVoice(text);
      const tmpPath = path.join(
        os.tmpdir(),
        `tele-voice-${Date.now()}-${randomBytes(4).toString("hex")}.wav`,
      );
      await fs.writeFile(tmpPath, buffer);
      try {
        if (opts.replyAdapter?.sendVoice) {
          const { message_id } = await opts.replyAdapter.sendVoice(
            tmpPath,
            mimeType,
            durationSec,
          );
          await opts.replyAdapter.persistOutbound(`[Voice] ${text}`, message_id);
        } else {
          await sendVoice(chat, tmpPath, mimeType, durationSec, text, "ai");
        }
        incCounter("responder.voice_sent");
        return;
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    } catch (err) {
      logger.warn("voice synthesis failed; falling back to text", {
        chat: chat.id,
        err: err instanceof Error ? err.message : String(err),
      });
      incCounter("responder.tts_fallback");
      // fall through to text reply path below
    }
  }

  const finalText = prefix && !opts?.replyAdapter ? `${prefix} ${text}` : text;
  if (opts?.replyAdapter) {
    const { message_id } = await opts.replyAdapter.sendText(finalText);
    await opts.replyAdapter.persistOutbound(finalText, message_id);
  } else {
    await sendReply(chat, finalText, "ai");
    if (settings.reaction_done && incomingTgMsgId && !opts?.voiceReply) {
      await sendReaction(chat.tg_chat_id, incomingTgMsgId, settings.reaction_done);
    }
  }
  incCounter("responder.reply_sent");
}
