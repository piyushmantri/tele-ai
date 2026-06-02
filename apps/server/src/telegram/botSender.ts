import { Api } from "telegram";
import { getBotClient } from "./botClient.js";
import { insertMessage } from "../db/repos/messages.js";
import { bumpChatActivity, getChatById } from "../db/repos/chats.js";
import { eventBus } from "../util/eventBus.js";

export interface ReplyAdapter {
  sendText(text: string, buttons?: unknown): Promise<{ message_id: string | null }>;
  sendVoice?(
    filePath: string,
    mimeType: string,
    durationSec: number,
  ): Promise<{ message_id: string | null }>;
  persistOutbound(text: string, tgMessageId: string | null): Promise<void>;
}

export function makeBotReplyAdapter(tgChatId: string, dbChatId: string): ReplyAdapter {
  return {
    async sendText(text, buttons) {
      const client = getBotClient();
      if (!client) throw new Error("bot client not running");
      // GramJS MarkupLike is a wide discriminated union; cast scoped here per lessons-2026-05-02.
      const sent = await client.sendMessage(Number(tgChatId), {
        message: text,
        buttons: buttons as never,
      });
      return { message_id: sent.id != null ? String(sent.id) : null };
    },
    async sendVoice(filePath, mimeType, durationSec) {
      const client = getBotClient();
      if (!client) throw new Error("bot client not running");
      // mimeType is supported at runtime but missing from SendFileInterface typings.
      const sent = await client.sendFile(Number(tgChatId), {
        file: filePath,
        voiceNote: true,
        mimeType,
        attributes: [
          new Api.DocumentAttributeAudio({
            duration: Math.max(1, Math.round(durationSec)),
            voice: true,
          }),
        ],
      } as any);
      return { message_id: sent.id != null ? String(sent.id) : null };
    },
    async persistOutbound(text, tgMessageId) {
      const message = await insertMessage({
        chat_id: dbChatId,
        tg_message_id: tgMessageId,
        direction: "out",
        text,
        source: "ai",
      });
      await bumpChatActivity(dbChatId, new Date());
      const updated = await getChatById(dbChatId);
      if (updated) {
        eventBus.emit({ type: "message:sent", payload: { chat: updated, message } });
      }
    },
  };
}
