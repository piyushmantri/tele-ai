import { Api } from "telegram";
import { Button } from "telegram/tl/custom/button.js";
import type { ToolDef } from "./index.js";
import { getBotClient } from "../../telegram/botClient.js";

interface ButtonInput {
  text: string;
  callback_data: string;
}

function validateButtons(rows: unknown): { ok: true; matrix: ButtonInput[][] } | { ok: false; error: string } {
  if (!Array.isArray(rows)) return { ok: false, error: "buttons must be a 2D array of { text, callback_data }" };
  const matrix: ButtonInput[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return { ok: false, error: "each buttons row must be an array" };
    const out: ButtonInput[] = [];
    for (const b of row) {
      if (!b || typeof b !== "object") return { ok: false, error: "each button must be an object" };
      const text = (b as { text?: unknown }).text;
      const callbackData = (b as { callback_data?: unknown }).callback_data;
      if (typeof text !== "string" || !text) return { ok: false, error: "button.text must be a non-empty string" };
      if (typeof callbackData !== "string") return { ok: false, error: "button.callback_data must be a string" };
      if (Buffer.byteLength(callbackData, "utf8") > 64) {
        return { ok: false, error: "callback_data > 64 bytes (Telegram limit)" };
      }
      out.push({ text, callback_data: callbackData });
    }
    matrix.push(out);
  }
  return { ok: true, matrix };
}

function toGramJsButtons(matrix: ButtonInput[][]): Api.KeyboardButtonCallback[][] {
  return matrix.map((row) => row.map((b) => Button.inline(b.text, Buffer.from(b.callback_data))));
}

export function makeBotMessageTools(tgChatId: string): ToolDef[] {
  return [
    makeSendMessageWithButtons(tgChatId),
    makeEditMessageButtons(tgChatId),
    makeSetBotCommands(),
  ];
}

function makeSendMessageWithButtons(tgChatId: string): ToolDef {
  return {
    declaration: {
      name: "send_message_with_buttons",
      description:
        "Send a message with an inline keyboard via the bot. Each button has a `callback_data` (max 64 bytes UTF-8) that is sent back when pressed.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text shown above the keyboard." },
          buttons: {
            type: "array",
            description:
              "2D array of buttons: rows of { text, callback_data }. callback_data must be <= 64 bytes UTF-8.",
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  callback_data: { type: "string" },
                },
                required: ["text", "callback_data"],
              },
            },
          },
        },
        required: ["text", "buttons"],
      },
    },
    handler: async (args) => {
      const a = args as { text?: unknown; buttons?: unknown };
      const text = typeof a.text === "string" ? a.text : "";
      if (!text) return { ok: false, error: "text is required" };
      const v = validateButtons(a.buttons);
      if (!v.ok) return v;
      const client = getBotClient();
      if (!client) return { ok: false, error: "bot client not running" };
      try {
        const sent = await client.sendMessage(Number(tgChatId), {
          message: text,
          buttons: toGramJsButtons(v.matrix) as never,
        });
        return { ok: true, message_id: sent.id != null ? String(sent.id) : null };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function makeEditMessageButtons(tgChatId: string): ToolDef {
  return {
    declaration: {
      name: "edit_message_buttons",
      description:
        "Edit (replace) the inline-keyboard buttons on a previously sent bot message. Pass the message_id you got back from send_message_with_buttons.",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "integer", description: "Telegram message id to edit." },
          buttons: {
            type: "array",
            description:
              "New 2D array of buttons: rows of { text, callback_data }. callback_data must be <= 64 bytes UTF-8.",
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  callback_data: { type: "string" },
                },
                required: ["text", "callback_data"],
              },
            },
          },
        },
        required: ["message_id", "buttons"],
      },
    },
    handler: async (args) => {
      const a = args as { message_id?: unknown; buttons?: unknown };
      const messageId = typeof a.message_id === "number" ? a.message_id : Number(a.message_id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return { ok: false, error: "message_id must be a positive integer" };
      }
      const v = validateButtons(a.buttons);
      if (!v.ok) return v;
      const client = getBotClient();
      if (!client) return { ok: false, error: "bot client not running" };
      try {
        await client.editMessage(Number(tgChatId), {
          message: messageId,
          buttons: toGramJsButtons(v.matrix) as never,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function makeSetBotCommands(): ToolDef {
  return {
    declaration: {
      name: "set_bot_commands",
      description:
        "Register the bot's slash-command menu (the `/` menu shown in the Telegram client). Replaces any previous commands.",
      parameters: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            items: {
              type: "object",
              properties: {
                command: { type: "string", description: "Lowercase command name (no leading slash)." },
                description: { type: "string", description: "Short description shown in the menu." },
              },
              required: ["command", "description"],
            },
          },
        },
        required: ["commands"],
      },
    },
    handler: async (args) => {
      const a = args as { commands?: unknown };
      if (!Array.isArray(a.commands)) return { ok: false, error: "commands must be an array" };
      const commands: { command: string; description: string }[] = [];
      for (const c of a.commands) {
        if (!c || typeof c !== "object") return { ok: false, error: "each command must be an object" };
        const command = (c as { command?: unknown }).command;
        const description = (c as { description?: unknown }).description;
        if (typeof command !== "string" || !command) return { ok: false, error: "command must be a non-empty string" };
        if (typeof description !== "string") return { ok: false, error: "description must be a string" };
        commands.push({ command, description });
      }
      const client = getBotClient();
      if (!client) return { ok: false, error: "bot client not running" };
      try {
        await client.invoke(
          new Api.bots.SetBotCommands({
            scope: new Api.BotCommandScopeDefault(),
            langCode: "en",
            commands: commands.map(
              (c) => new Api.BotCommand({ command: c.command, description: c.description }),
            ),
          }),
        );
        return { ok: true, count: commands.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
