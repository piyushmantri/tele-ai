import type { ToolDef } from "./index.js";
import { setChatBlocked } from "../../db/repos/chats.js";

export function makeChatControlTools(currentChatId: string): ToolDef[] {
  return [
    {
      declaration: {
        name: "block_self",
        description:
          "Block this chat so the AI stops responding automatically. Call when the user asks you to stop, be quiet, block yourself, or not reply anymore. After calling this, send a short farewell then stop.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      handler: async () => {
        await setChatBlocked(currentChatId, true);
        return { ok: true };
      },
    },
    {
      declaration: {
        name: "unblock_self",
        description:
          "Unblock this chat so the AI resumes responding. Call when the user asks you to come back, start replying again, or unblock yourself.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      handler: async () => {
        await setChatBlocked(currentChatId, false);
        return { ok: true };
      },
    },
  ];
}
