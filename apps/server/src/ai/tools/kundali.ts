import { getActiveApplicationsForChat } from "../../db/repos/applications.js";
import { makeStoreResult } from "../appDatabase.js";
import { logger } from "../../util/logger.js";
import type { ToolDef } from "./index.js";

export function makeStoreKundaliMatchTool(chatId: string): ToolDef {
  return {
    declaration: {
      name: "store_kundali_match",
      description:
        "Persist a completed Kundali match result to the application database. Call this immediately after computing an Ashtakoot match, passing the candidate details and scores.",
      parameters: {
        type: "object",
        properties: {
          candidate_name: { type: "string", description: "Full name of the candidate" },
          candidate_dob: { type: "string", description: "Date of birth in YYYY-MM-DD format" },
          candidate_gender: { type: "string", description: "Gender of the candidate" },
          candidate_tob: { type: "string", description: "Time of birth HH:MM (optional)" },
          candidate_pob: { type: "string", description: "Place of birth (optional)" },
          ashtakoot_total: { type: "number", description: "Total Ashtakoot score" },
          ashtakoot_max: { type: "number", description: "Maximum possible Ashtakoot score (36)" },
          summary: { type: "string", description: "One-line match summary e.g. 'Excellent match (32/36)'" },
        },
        required: ["candidate_name", "candidate_dob", "candidate_gender", "ashtakoot_total", "ashtakoot_max"],
      },
    },
    handler: async (args: unknown): Promise<unknown> => {
      try {
        const a = args as Record<string, unknown>;
        const apps = await getActiveApplicationsForChat(chatId);
        const kundaliApp = apps.find(
          (ap) => ap.registry_slug === "kundali-match" || ap.slug.includes("kundali"),
        );
        if (!kundaliApp) {
          logger.warn("store_kundali_match: no kundali app active for chat", { chatId });
          return { ok: false, reason: "no kundali application active for this chat" };
        }
        if (!kundaliApp.database_url) {
          logger.warn("store_kundali_match: kundali app has no database_url", { slug: kundaliApp.slug });
          return { ok: false, reason: "kundali application has no database configured" };
        }
        const score =
          typeof a.ashtakoot_total === "number" && typeof a.ashtakoot_max === "number" && a.ashtakoot_max > 0
            ? a.ashtakoot_total / a.ashtakoot_max
            : null;
        const store = makeStoreResult(kundaliApp.id, kundaliApp.database_url, kundaliApp.installed_path);
        await store({
          candidate_name: a.candidate_name,
          candidate_dob: a.candidate_dob,
          candidate_gender: a.candidate_gender,
          candidate_tob: a.candidate_tob ?? null,
          candidate_pob: a.candidate_pob ?? null,
          ashtakoot_total: a.ashtakoot_total,
          ashtakoot_max: a.ashtakoot_max,
          score,
          summary: a.summary ?? null,
        });
        return { ok: true };
      } catch (err) {
        logger.warn("store_kundali_match handler error", {
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, reason: String(err) };
      }
    },
  };
}
