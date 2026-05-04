import type { ToolDef } from "./index.js";
import {
  createReminder,
  deactivateReminder,
  getReminder,
  listReminders,
} from "../../db/repos/reminders.js";
import { searchChats } from "../../db/repos/chats.js";
import { scheduleReminder, unscheduleReminder } from "../../scheduler/index.js";

export function makeReminderTools(currentChatId: string): ToolDef[] {
  const lookup: ToolDef = {
    declaration: {
      name: "lookup_contacts",
      description:
        "Search known Telegram contacts by name or username. Call this before scheduling a reminder for someone other than the current chat. Returns a list of matches with id, first_name, last_name, username, tg_chat_id. If multiple matches exist, ask the user to clarify which contact they mean before proceeding.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or @username fragment to search." },
        },
        required: ["query"],
      },
    },
    handler: async (args) => {
      const q = String((args as { query?: unknown }).query ?? "").trim();
      if (!q) return { ok: false, error: "query required" };
      const chats = await searchChats(q);
      return {
        ok: true,
        contacts: chats.map((c) => ({
          id: c.id,
          tg_chat_id: c.tg_chat_id,
          first_name: c.first_name,
          last_name: c.last_name,
          username: c.username,
        })),
        count: chats.length,
      };
    },
  };

  const schedule: ToolDef = {
    declaration: {
      name: "schedule_reminder",
      description:
        "Schedule a reminder message to be sent to a chat at a future time. " +
        "If the reminder is for someone other than the current chat, call lookup_contacts first to get their id — if multiple contacts match the name, ask the user to confirm which one before scheduling. " +
        "Provide either a cron expression (recurring) or an ISO-8601 timestamp (one-shot).",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Reminder text to send." },
          when_cron: {
            type: "string",
            description: "Standard 5-field cron (e.g., '0 9 * * *' for 9am daily).",
          },
          when_iso: {
            type: "string",
            description: "ISO-8601 timestamp for a one-shot reminder.",
          },
          target_chat_id: {
            type: "string",
            description:
              "Internal chat UUID. Defaults to current chat. For a different contact use the id field returned by lookup_contacts.",
          },
        },
        required: ["message"],
      },
    },
    handler: async (args) => {
      const a = args as {
        message?: string;
        when_cron?: string;
        when_iso?: string;
        target_chat_id?: string;
      };
      if (!a.message) return { ok: false, error: "message required" };
      if (!a.when_cron && !a.when_iso)
        return { ok: false, error: "either when_cron or when_iso is required" };
      const reminder = await createReminder({
        target_chat_id: a.target_chat_id || currentChatId,
        message: a.message,
        cron_expr: a.when_cron ?? null,
        fire_at: a.when_iso ?? null,
        source: "ai",
      });
      scheduleReminder(reminder);
      return { ok: true, reminder };
    },
  };

  const list: ToolDef = {
    declaration: {
      name: "list_reminders",
      description: "List all currently active reminders, including who they are for.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const rows = await listReminders(true);
      return { ok: true, reminders: rows };
    },
  };

  const cancel: ToolDef = {
    declaration: {
      name: "cancel_reminder",
      description: "Cancel an active reminder by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const id = String((args as { id?: unknown }).id ?? "");
      const existing = await getReminder(id);
      if (!existing) return { ok: false, error: "not found" };
      await deactivateReminder(id);
      unscheduleReminder(id);
      return { ok: true };
    },
  };

  return [lookup, schedule, list, cancel];
}
