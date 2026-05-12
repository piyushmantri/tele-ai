import { query } from "../index.js";

export interface ModelPricingRow {
  model_id: string;
  input_per_1m_usd: string | null;
  output_per_1m_usd: string | null;
  source_url: string | null;
  fetched_at: string | null;
  override_input: string | null;
  override_output: string | null;
  auto_refresh_enabled: boolean;
  updated_at: string;
}

const COLUMNS =
  "model_id, input_per_1m_usd, output_per_1m_usd, source_url, fetched_at, override_input, override_output, auto_refresh_enabled, updated_at";

export async function getModelPricing(modelId: string): Promise<ModelPricingRow | null> {
  const rows = await query<ModelPricingRow>(
    `SELECT ${COLUMNS} FROM model_pricing WHERE model_id = $1`,
    [modelId],
  );
  return rows[0] ?? null;
}

export interface UpsertModelPricingArgs {
  model_id: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  source_url: string;
  fetched_at: Date;
}

export async function upsertModelPricing(args: UpsertModelPricingArgs): Promise<void> {
  await query(
    `INSERT INTO model_pricing (model_id, input_per_1m_usd, output_per_1m_usd, source_url, fetched_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (model_id) DO UPDATE
       SET input_per_1m_usd = EXCLUDED.input_per_1m_usd,
           output_per_1m_usd = EXCLUDED.output_per_1m_usd,
           source_url = EXCLUDED.source_url,
           fetched_at = EXCLUDED.fetched_at,
           updated_at = now()`,
    [
      args.model_id,
      args.input_per_1m_usd,
      args.output_per_1m_usd,
      args.source_url,
      args.fetched_at.toISOString(),
    ],
  );
}

export async function setOverride(
  modelId: string,
  input: number | null,
  output: number | null,
): Promise<void> {
  // INSERT-or-UPDATE only the override columns. Keeps auto-fetched columns intact.
  await query(
    `INSERT INTO model_pricing (model_id, override_input, override_output, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (model_id) DO UPDATE
       SET override_input = EXCLUDED.override_input,
           override_output = EXCLUDED.override_output,
           updated_at = now()`,
    [modelId, input, output],
  );
}
