// Dual-SDK split: legacy `@google/generative-ai` for transcription (used elsewhere
// in this codebase), new `@google/genai` for TTS (the legacy SDK does not yet
// support speech synthesis). Imports namespaced to avoid identifier collision;
// types from the new SDK are not re-exported because they may drift.
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

export const MAX_VOICE_DURATION_SEC = 300;

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const genAINew = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY } as any);

export async function transcribeVoice(buf: Buffer, mimeType: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: config.GEMINI_MODEL });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: buf.toString("base64") } },
          {
            text: "Transcribe this voice message verbatim. Output ONLY the transcript text, no commentary, no markdown.",
          },
        ],
      },
    ],
  });
  return result.response.text().trim();
}

export async function synthesizeVoice(
  text: string,
): Promise<{ buffer: Buffer; mimeType: "audio/wav"; durationSec: number }> {
  const resp = await (genAINew as any).models.generateContent({
    model: config.GEMINI_TTS_MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["audio"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: config.GEMINI_TTS_VOICE },
        },
      },
    },
  });

  const parts: Array<{ inlineData?: { mimeType?: string; data?: string } }> =
    (resp as any)?.candidates?.[0]?.content?.parts ?? [];

  const pcmChunks: Buffer[] = [];
  let sampleRate = 24000;
  for (const p of parts) {
    const mt = p.inlineData?.mimeType;
    const data = p.inlineData?.data;
    if (!mt || !data) continue;
    if (!/^audio\/L16/i.test(mt)) continue;
    const rateMatch = /rate=(\d+)/i.exec(mt);
    if (rateMatch && rateMatch[1]) sampleRate = Number(rateMatch[1]);
    pcmChunks.push(Buffer.from(data, "base64"));
  }

  if (pcmChunks.length === 0) {
    throw new Error("TTS returned no audio");
  }

  const pcm = Buffer.concat(pcmChunks);
  const header = buildWavHeader(pcm.length, {
    sampleRate,
    numChannels: 1,
    bitsPerSample: 16,
  });
  const buffer = Buffer.concat([header, pcm]);
  const durationSec = pcm.length / (sampleRate * 1 * (16 / 8));
  return { buffer, mimeType: "audio/wav", durationSec };
}

export function buildWavHeader(
  pcmLength: number,
  opts: { sampleRate: number; numChannels: number; bitsPerSample: number },
): Buffer {
  const { sampleRate, numChannels, bitsPerSample } = opts;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmLength, 40);
  return header;
}
