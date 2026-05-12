import { GoogleGenerativeAI, type Tool } from "@google/generative-ai";
import { z } from "zod";
import { config } from "../config.js";
import { getModelPricing, upsertModelPricing } from "../db/repos/modelPricing.js";
import { logger } from "../util/logger.js";

export interface ActivePricing {
  model_id: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  source_url: string | null;
  fetched_at: string;
  is_override: boolean;
}

// Synchronously-readable cached snapshot. Atomically swapped in loadPricingFromDb()
// so the cost-counter site (lessons-2026-05-08 "synchronous coherent snapshot")
// never sees a half-written object.
let cached: ActivePricing | null = null;

export function getCurrentPricing(_modelId?: string): ActivePricing | null {
  // _modelId reserved for future per-model breakdown; v1 always uses config.GEMINI_MODEL.
  return cached;
}

export interface PricingMeta {
  model_id: string;
  input_per_1m_usd: number | null;
  output_per_1m_usd: number | null;
  fetched_at: string | null;
  source_url: string | null;
  is_override: boolean;
}

export function getPricingMeta(): PricingMeta {
  if (!cached) {
    return {
      model_id: config.GEMINI_MODEL,
      input_per_1m_usd: null,
      output_per_1m_usd: null,
      fetched_at: null,
      source_url: null,
      is_override: false,
    };
  }
  return {
    model_id: cached.model_id,
    input_per_1m_usd: cached.input_per_1m_usd,
    output_per_1m_usd: cached.output_per_1m_usd,
    fetched_at: cached.fetched_at,
    source_url: cached.source_url,
    is_override: cached.is_override,
  };
}

function toNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function loadPricingFromDb(): Promise<void> {
  try {
    const row = await getModelPricing(config.GEMINI_MODEL);
    if (!row) {
      cached = null;
      return;
    }
    const oin = toNum(row.override_input);
    const oout = toNum(row.override_output);
    const ain = toNum(row.input_per_1m_usd);
    const aout = toNum(row.output_per_1m_usd);
    let next: ActivePricing | null = null;
    if (oin != null && oout != null) {
      next = {
        model_id: row.model_id,
        input_per_1m_usd: oin,
        output_per_1m_usd: oout,
        source_url: row.source_url,
        fetched_at: row.fetched_at ?? new Date(0).toISOString(),
        is_override: true,
      };
    } else if (ain != null && aout != null) {
      next = {
        model_id: row.model_id,
        input_per_1m_usd: ain,
        output_per_1m_usd: aout,
        source_url: row.source_url,
        fetched_at: row.fetched_at ?? new Date(0).toISOString(),
        is_override: false,
      };
    }
    cached = next;
  } catch (err) {
    // Non-fatal: leave existing cached value; log and proceed.
    logger.error("loadPricingFromDb failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

const PRICING_PROMPT = (modelId: string) =>
  `You have access to Google Search. Use it to find the CURRENT public per-token pricing for the Gemini API model "${modelId}" from Google's official documentation at ai.google.dev/pricing or the equivalent Google Cloud pricing page.

Return ONLY a single JSON object on a single line with EXACTLY these fields and no others:
{"model_id":"${modelId}","input_per_1m_usd":<number>,"output_per_1m_usd":<number>,"source_url":"<https URL of the page you used>"}

Rules:
- input_per_1m_usd is the price in USD per 1,000,000 input (prompt) tokens for the standard tier (NOT batch, NOT context-cached).
- output_per_1m_usd is the price in USD per 1,000,000 output (completion) tokens for the standard tier.
- If the model has tiered pricing by prompt size, use the rate for prompts up to 200K tokens.
- source_url MUST be the actual page from ai.google.dev or cloud.google.com that you read the price from — not a search results page.
- No markdown, no code fences, no commentary, no trailing text. JUST the JSON object.

If you cannot find authoritative current pricing for "${modelId}" specifically, return {"error":"not_found"} instead.`;

const PricingResponseSchema = z.object({
  model_id: z.string().min(1),
  input_per_1m_usd: z.number().positive().lt(1_000_000),
  output_per_1m_usd: z.number().positive().lt(1_000_000),
  source_url: z.string().url().startsWith("https://"),
});

function stripCodeFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function refreshPricing(): Promise<void> {
  const modelId = config.GEMINI_MODEL;
  try {
    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    // Gemini 3+ uses `googleSearch` tool. Older models (1.x/2.x) use
    // `googleSearchRetrieval`. Cast required because @google/generative-ai
    // v0.21 types don't include `googleSearch` yet.
    const tools: Tool[] = [{ googleSearch: {} } as unknown as Tool];
    const model = genAI.getGenerativeModel({
      model: modelId,
      tools,
      generationConfig: { temperature: 0.0 },
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: PRICING_PROMPT(modelId) }] }],
    });
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .join("")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = JSON.parse(stripCodeFences(text));
      } catch {
        logger.warn("pricing fetch returned unparsable response", {
          model: modelId,
          raw: text.slice(0, 500),
        });
        return;
      }
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as { error?: unknown }).error === "not_found"
    ) {
      logger.warn("pricing fetch returned not_found", { model: modelId });
      return;
    }

    const safe = PricingResponseSchema.safeParse(parsed);
    if (!safe.success) {
      logger.warn("pricing fetch returned unparsable response", {
        model: modelId,
        raw: text.slice(0, 500),
        zod: safe.error.message.slice(0, 200),
      });
      return;
    }

    await upsertModelPricing({
      model_id: modelId,
      input_per_1m_usd: safe.data.input_per_1m_usd,
      output_per_1m_usd: safe.data.output_per_1m_usd,
      source_url: safe.data.source_url,
      fetched_at: new Date(),
    });
    await loadPricingFromDb();
    logger.info("pricing refreshed", {
      model: modelId,
      input: safe.data.input_per_1m_usd,
      output: safe.data.output_per_1m_usd,
    });
  } catch (err) {
    logger.error("pricing refresh failed", {
      model: modelId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
