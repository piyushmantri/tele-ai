import type { ToolDef } from "./index.js";
import { getChatById } from "../../db/repos/chats.js";
import { listSentPolls } from "../../db/repos/polls.js";
import { sendPoll } from "../../telegram/sender.js";
import { getClient } from "../../telegram/client.js";

export function makePollTools(currentChatId: string, tgChatId: string): ToolDef[] {
  return [makeSendPollTool(currentChatId), makeGetPollResultsTool(currentChatId, tgChatId)];
}

function makeSendPollTool(currentChatId: string): ToolDef {
  return {
    declaration: {
      name: "send_poll",
      description:
        "Send a Telegram poll to the current chat. Use this when the user must pick from a discrete set of options (2-10). After sending, tell the user they can ask you to check results when ready.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The poll question shown above the options." },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 10,
            description: "Between 2 and 10 answer options.",
          },
          anonymous: {
            type: "boolean",
            description: "If false, voters' identities are visible. Default true.",
          },
          multiple_choice: {
            type: "boolean",
            description:
              "Allow voters to pick more than one option. Default false. Cannot be combined with quiz_correct_index.",
          },
          quiz_correct_index: {
            type: "integer",
            description:
              "0-based index of the correct answer. When set, sends a quiz poll. Cannot be combined with multiple_choice.",
          },
        },
        required: ["question", "options"],
      },
    },
    handler: async (args) => {
      const a = args as {
        question?: unknown;
        options?: unknown;
        anonymous?: unknown;
        multiple_choice?: unknown;
        quiz_correct_index?: unknown;
      };
      const question = typeof a.question === "string" ? a.question.trim() : "";
      if (!question) return { ok: false, error: "question is required" };

      if (!Array.isArray(a.options)) return { ok: false, error: "options must be an array" };
      const options = a.options.map((o) => String(o));
      if (options.length < 2 || options.length > 10) {
        return { ok: false, error: "options must contain between 2 and 10 entries" };
      }

      const anonymous = typeof a.anonymous === "boolean" ? a.anonymous : true;
      const multipleChoice = typeof a.multiple_choice === "boolean" ? a.multiple_choice : false;
      const quizIndex =
        typeof a.quiz_correct_index === "number" && Number.isInteger(a.quiz_correct_index)
          ? a.quiz_correct_index
          : undefined;

      if (multipleChoice && quizIndex !== undefined) {
        return { ok: false, error: "multiple_choice and quiz_correct_index cannot be combined" };
      }
      if (quizIndex !== undefined && (quizIndex < 0 || quizIndex >= options.length)) {
        return { ok: false, error: "quiz_correct_index out of range" };
      }

      const chat = await getChatById(currentChatId);
      if (!chat) return { ok: false, error: "current chat not found in db" };

      try {
        await sendPoll(chat, question, options, { anonymous, multiple_choice: multipleChoice, quiz_correct_index: quizIndex }, "ai");
        return { ok: true, count: options.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function makeGetPollResultsTool(currentChatId: string, tgChatId: string): ToolDef {
  return {
    declaration: {
      name: "get_poll_results",
      description:
        "Fetch current results of polls sent to this chat. Call when the user asks to check poll results or wants you to act on a poll outcome. Returns vote counts per option.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    handler: async () => {
      const polls = await listSentPolls(currentChatId, 5);
      if (polls.length === 0) return { ok: true, polls: [] };

      const client = getClient();
      const results = await Promise.all(
        polls.map(async (p) => {
          if (!p.tg_message_id) {
            return { question: p.question, options: p.options, note: "message id not available" };
          }
          try {
            const msgs = await client.getMessages(Number(tgChatId), {
              ids: [Number(p.tg_message_id)],
            });
            const msg = msgs[0] as unknown as Record<string, unknown> | undefined;
            if (!msg) return { question: p.question, options: p.options, note: "message not found" };

            const media = msg["media"] as Record<string, unknown> | undefined;
            const pollResults = media?.["results"] as Record<string, unknown> | undefined;
            const resultsArr = (pollResults?.["results"] as Array<Record<string, unknown>>) ?? [];
            const totalVoters = (pollResults?.["totalVoters"] as number) ?? 0;

            const votes = resultsArr.map((r) => {
              const optBuf = r["option"] as Buffer | Uint8Array | undefined;
              const idx = optBuf ? (optBuf[0] ?? 0) : 0;
              return {
                option: p.options[idx] ?? `Option ${idx}`,
                voters: (r["voters"] as number) ?? 0,
                chosen: (r["chosen"] as boolean) ?? false,
              };
            });

            return { question: p.question, options: p.options, total_voters: totalVoters, votes };
          } catch (err) {
            return {
              question: p.question,
              options: p.options,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      return { ok: true, polls: results };
    },
  };
}
