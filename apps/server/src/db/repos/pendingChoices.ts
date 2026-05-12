import { sql } from "../index.js";

export interface PendingChoice {
  id: string;
  token: string;
  source_chat_id: string;
  question: string;
  options: string[];
  delivered_via: "bot" | "text";
  delivery_chat_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export async function createPendingChoice(input: {
  token: string;
  source_chat_id: string;
  question: string;
  options: string[];
  delivered_via: "bot" | "text";
  delivery_chat_id: string;
  ttl_seconds?: number;
}): Promise<PendingChoice> {
  const ttl = input.ttl_seconds ?? 86400;
  const rows = (await sql`
    INSERT INTO pending_choices (
      token, source_chat_id, question, options, delivered_via, delivery_chat_id, expires_at
    ) VALUES (
      ${input.token},
      ${input.source_chat_id},
      ${input.question},
      ${JSON.stringify(input.options)}::jsonb,
      ${input.delivered_via},
      ${input.delivery_chat_id},
      now() + make_interval(secs => ${ttl})
    )
    RETURNING id, token, source_chat_id, question, options, delivered_via,
              delivery_chat_id, expires_at, consumed_at, created_at
  `) as PendingChoice[];
  return rows[0]!;
}

export async function getPendingChoiceByToken(token: string): Promise<PendingChoice | null> {
  const rows = (await sql`
    SELECT id, token, source_chat_id, question, options, delivered_via,
           delivery_chat_id, expires_at, consumed_at, created_at
      FROM pending_choices
     WHERE token = ${token}
  `) as PendingChoice[];
  return rows[0] ?? null;
}

export async function consumePendingChoice(token: string): Promise<PendingChoice | null> {
  const rows = (await sql`
    UPDATE pending_choices
       SET consumed_at = now()
     WHERE token = ${token}
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING id, token, source_chat_id, question, options, delivered_via,
               delivery_chat_id, expires_at, consumed_at, created_at
  `) as PendingChoice[];
  return rows[0] ?? null;
}
