import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { ToolDef } from "./index.js";
import { config } from "../../config.js";
import { getChatById } from "../../db/repos/chats.js";
import { sendFile } from "../../telegram/sender.js";
import { logger } from "../../util/logger.js";

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

export function makeGenerateImageTool(currentChatId: string): ToolDef {
  return {
    declaration: {
      name: "generate_image",
      description:
        "Generate a PNG image from a text prompt using Gemini and send it directly to the current Telegram chat as a photo. " +
        "Returns only a small ack ({ ok, sent, prompt }); the image bytes are NOT included in the response.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Descriptive prompt of the image to generate." },
        },
        required: ["prompt"],
      },
    },
    handler: async (args) => {
      const prompt = String((args as { prompt?: unknown })?.prompt ?? "").trim();
      if (!prompt) return { ok: false, error: "prompt is required" };

      const chat = await getChatById(currentChatId);
      if (!chat) return { ok: false, error: "current chat not found in db" };

      try {
        // `responseModalities` is not in @google/generative-ai v0.21's GenerationConfig type;
        // the SDK forwards it to the REST body unchanged.
        const model = genAI.getGenerativeModel({
          model: config.GEMINI_IMAGE_MODEL,
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] } as any,
        });

        const result = await model.generateContent(prompt);
        const parts: Part[] = result.response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find(
          (p): p is Part & { inlineData: NonNullable<Part["inlineData"]> } =>
            !!p.inlineData && typeof p.inlineData.mimeType === "string" && p.inlineData.mimeType.startsWith("image/"),
        );

        if (!imagePart) {
          const textPart = parts
            .map((p) => (typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
            .join("")
            .trim();
          logger.warn("generate_image: no image part returned", { prompt, text: textPart });
          return { ok: false, error: "model returned no image" };
        }

        const buf = Buffer.from(imagePart.inlineData.data, "base64");
        const mime = imagePart.inlineData.mimeType;
        const ext = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";
        const tmpPath = path.join(
          os.tmpdir(),
          `tele-img-${Date.now()}-${randomBytes(4).toString("hex")}${ext}`,
        );
        await fs.writeFile(tmpPath, buf);

        try {
          await sendFile(chat, tmpPath, prompt, "ai");
          return { ok: true, sent: true, prompt };
        } finally {
          await fs.unlink(tmpPath).catch(() => {});
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
