import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env lives at the monorepo root (three levels up from apps/server/src/)
dotenvConfig({ path: resolve(__dirname, "../../../.env") });
import { z } from "zod";

const schema = z.object({
  TG_API_ID: z.coerce.number().int().positive(),
  TG_API_HASH: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-3-flash-preview"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-3.1-flash-image-preview"),
  // Preview-tier model names may drift; env-var override is the escape hatch.
  GEMINI_TTS_MODEL: z.string().default("gemini-3.1-flash-tts-preview"),
  GEMINI_TTS_VOICE: z.string().default("Aoede"),
  DATABASE_URL: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKSPACE_ROOT: z.string().min(1),
  SESSION_FILE: z.string().default("data/session.txt"),
  INFLUXDB_URL: z.string().url().optional(),
  INFLUXDB_TOKEN: z.string().min(1).optional(),
  INFLUXDB_ORG: z.string().min(1).optional(),
  INFLUXDB_BUCKET: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);

export function maskedDatabaseUrl(): string {
  try {
    const u = new URL(config.DATABASE_URL);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}
