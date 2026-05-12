import { randomBytes } from "node:crypto";
import { Button } from "telegram/tl/custom/button.js";
import type { Chat } from "@tele/shared";
import type { ToolDef } from "./index.js";
import { getBotClient } from "../../telegram/botClient.js";
import { getChatById } from "../../db/repos/chats.js";
import { getSettings } from "../../db/repos/settings.js";
import { sendReply } from "../../telegram/sender.js";
import { createPendingChoice } from "../../db/repos/pendingChoices.js";
import { logger } from "../../util/logger.js";

export function makeAskUserChoiceTool(
  dbChatId: string,
  tgChatId: string,
  chatType: Chat["chat_type"],
): ToolDef {
  return {
    declaration: {
      name: "ask_user_choice",
      description:
        "Ask the user to pick ONE option from a small list (2-8 choices). Returns IMMEDIATELY " +
        "with { ok, sent }; you MUST end your turn after calling this. The user's selection " +
        "will arrive later as a new \"[Choice: <label>]\" user message — respond to that as a " +
        "fresh turn. Use this for: status changes, yes/no decisions, picking among a few items. " +
        "Do NOT use send_message_with_buttons for decisions — only ask_user_choice routes the " +
        "response back into your conversation.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question shown above the options.",
          },
          options: {
            type: "array",
            description:
              "2-8 short option labels. Each label appears as a button (or numbered text fallback).",
            items: { type: "string" },
          },
        },
        required: ["question", "options"],
      },
    },
    handler: async (args) => {
      try {
        const a = args as { question?: unknown; options?: unknown };
        const question = typeof a.question === "string" ? a.question.trim() : "";
        if (!question) return { ok: false, error: "question must be a non-empty string" };
        if (!Array.isArray(a.options)) {
          return { ok: false, error: "options must be an array of strings" };
        }
        if (a.options.length < 2 || a.options.length > 8) {
          return { ok: false, error: "options must have 2-8 entries" };
        }
        const options: string[] = [];
        for (const o of a.options) {
          if (typeof o !== "string" || !o.trim()) {
            return { ok: false, error: "each option must be a non-empty string" };
          }
          options.push(o);
        }

        const token = randomBytes(8).toString("base64url");

        // Lazy-resolve the bot client at invocation time, not registration time
        // (lessons-2026-05-07 — singleton may have been replaced by start/stop cycles).
        const buildButtons = () => {
          const rows: ReturnType<typeof Button.inline>[][] = [];
          for (let i = 0; i < options.length; i += 2) {
            const row = [
              Button.inline(options[i]!, Buffer.from(`c:${token}:${i}`)),
            ];
            if (i + 1 < options.length) {
              row.push(Button.inline(options[i + 1]!, Buffer.from(`c:${token}:${i + 1}`)));
            }
            rows.push(row);
          }
          return rows;
        };

        let deliveredVia: "bot" | "text" | null = null;

        // Load settings up-front so bot_prefix is available for both bot and text branches.
        const settings = await getSettings();
        const prefix = settings.bot_prefix?.trim();

        if (chatType === "bot") {
          const client = getBotClient();
          if (!client) {
            return { ok: false, error: "bot client not running and chat is bot-only" };
          }
          await client.sendMessage(Number(tgChatId), {
            message: question,
            buttons: buildButtons() as never,
          });
          deliveredVia = "bot";
        } else if (chatType === "group" || chatType === "channel") {
          // Prefix bot-sent messages in shared chats so the userbot router skips them
          // (router.ts:91-94 ignores messages whose text starts with settings.bot_prefix),
          // preventing a feedback loop when the userbot is also a member.
          const messageText = prefix ? `${prefix} ${question}` : question;
          try {
            const client = getBotClient();
            if (!client) throw new Error("bot client not running");
            const entity = await client.getInputEntity(Number(tgChatId)).catch(() => null);
            await client.sendMessage(entity ?? Number(tgChatId), {
              message: messageText,
              buttons: buildButtons() as never,
            });
            deliveredVia = "bot";
          } catch (err) {
            logger.warn("ask_user_choice bot send failed", {
              tgChatId,
              chatType,
              err: err instanceof Error ? err.message : String(err),
            });
            // fall through to text fallback below
          }
        }

        if (!deliveredVia) {
          // Text fallback path: user-account private DMs and bot-failed group/channel.
          const numbered = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
          const body = `${question}\n${numbered}\n\nReply with the number or the label.`;
          const finalText = prefix ? `${prefix} ${body}` : body;
          const chat = await getChatById(dbChatId);
          if (!chat) return { ok: false, error: "chat not found" };
          await sendReply(chat, finalText, "manual");
          deliveredVia = "text";
        }

        const row = await createPendingChoice({
          token,
          source_chat_id: dbChatId,
          question,
          options,
          delivered_via: deliveredVia,
          delivery_chat_id: dbChatId,
        });

        return {
          ok: true,
          sent: deliveredVia,
          token,
          expires_at: row.expires_at,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
