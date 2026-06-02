import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Part } from "@google/generative-ai";
import {
  getActiveApplicationsForChat,
  getApplication,
} from "../db/repos/applications.js";
import {
  listAppFilesMeta,
  listChatFilesMeta,
  type FileMeta,
} from "../db/repos/applicationFiles.js";
import { ensureGeminiUri } from "./geminiFiles.js";
import { recordAppCall, makeAppEmit } from "./applicationMetrics.js";
import { makeStoreResult } from "./appDatabase.js";
import { incCounter } from "../util/metrics.js";
import { logger } from "../util/logger.js";

// Hook is loaded via pathToFileURL(absolute).href + dynamic import() (per
// lessons-2026-05-15). The base directory is now per-row (installed_path on
// applications) instead of a single APPLICATIONS_DIR constant; this sidesteps
// the __dirname depth trap (lessons-2026-05-15). The .ts extension is the
// same dev-only caveat documented in install.ts and applicationSlash.ts —
// future tsc-build migration must touch all three sites.

const BINARY_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

interface CodeAppHookContext {
  emit?: (name: string, value?: number) => void;
  emitTimeseries?: (name: string, value: number) => void;
  storeResult?: (data: Record<string, unknown>) => Promise<void>;
  databaseUrl?: string | null;
}

interface CodeAppHookModule {
  // Optional ctx is a signature-widening (lessons-2026-05-21): 1-arg hooks
  // remain valid; new hooks receive a per-call `emit` closure for custom
  // metrics via [[applicationMetrics]] / makeAppEmit. The ctx widened on
  // 2026-05-27 to include `emitTimeseries` for typed line-chart metrics.
  getContext?: (chatId: string, ctx?: CodeAppHookContext) => Promise<string> | string;
}

async function loadCodeAppContext(
  installedPath: string,
  chatId: string,
  slug: string,
  applicationId: string,
  databaseUrl: string | null | undefined,
): Promise<string> {
  try {
    const hookPath = join(installedPath, "src", "hook.ts");
    const mod = (await import(pathToFileURL(hookPath).href)) as CodeAppHookModule;
    if (typeof mod.getContext !== "function") return "";
    const start = Date.now();
    try {
      const out = await mod.getContext(chatId, {
        ...makeAppEmit(slug),
        storeResult: makeStoreResult(applicationId, databaseUrl, installedPath),
        databaseUrl: databaseUrl ?? null,
      });
      try { recordAppCall(slug, Date.now() - start, true); } catch {
        // metrics must never throw out of the hook caller
      }
      return typeof out === "string" ? out : "";
    } catch (err) {
      try { recordAppCall(slug, Date.now() - start, false); } catch {
        // metrics must never throw out of the hook caller
      }
      throw err;
    }
  } catch (err) {
    logger.warn("application hook load failed", {
      installed_path: installedPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

async function buildFilePart(file: FileMeta): Promise<Part | string | null> {
  try {
    if (BINARY_MIME_TYPES.has(file.mime_type)) {
      const uri = await ensureGeminiUri(file);
      return { fileData: { mimeType: file.mime_type, fileUri: uri } } as Part;
    }
    // Text-type: read local file and return as string snippet
    const text = await readFile(file.local_path, "utf8");
    return `[File: ${file.filename}]\n${text}`;
  } catch (err) {
    logger.warn("failed to build file part", {
      fileId: file.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface ApplicationsContext {
  text: string;
  fileParts: Part[];
}

export async function buildApplicationsContext(chatId: string): Promise<ApplicationsContext> {
  try {
    const apps = await getActiveApplicationsForChat(chatId);
    const textFragments: string[] = [];
    const fileParts: Part[] = [];

    for (const app of apps) {
      const fresh = await getApplication(app.id);
      if (!fresh || !fresh.enabled) continue;

      let bodyText = "";
      if (fresh.type === "ai_only") {
        const sp = (fresh.system_prompt ?? "").trim();
        if (sp.length === 0) continue;
        const kb = (fresh.knowledge_base ?? "").trim();
        bodyText = kb.length > 0 ? `${sp}\n\n${kb}` : sp;
        // R12 / critic V7: ai_only apps have no hook to emit metrics from;
        // without this counter, /observability/apps/<ai-only-slug> would
        // render zero metrics and look broken. Depth-4 name matches the
        // existing app.<slug>.call.ok shape — no new depth exception.
        try { incCounter(`app.${fresh.slug}.ai_context_loaded`); } catch {
          // metrics must never throw into the context builder
        }
      } else {
        // code-type: hook lives at <installed_path>/src/hook.ts. If
        // installed_path is null (e.g. orphaned by migration 0023, or a
        // not-yet-reinstalled cross-host kundali per critic V3), skip with a
        // warn so the operator can re-install from the dashboard's Browse
        // tab. Per-item isolation: one missing hook must not poison siblings.
        if (!fresh.installed_path) {
          logger.warn("code app missing installed_path", { slug: fresh.slug });
          continue;
        }
        bodyText = (await loadCodeAppContext(fresh.installed_path, chatId, fresh.slug, fresh.id, fresh.database_url)).trim();
      }

      if (bodyText) {
        textFragments.push(`--- Application: ${fresh.name} ---\n${bodyText}`);
      }

      // Load app-level files (dashboard uploads, apply to all chats)
      const appFiles = await listAppFilesMeta(fresh.id);
      // Load chat-scoped files (Telegram uploads for this chat)
      const chatFiles = await listChatFilesMeta(fresh.id, chatId);
      const allFiles = [...appFiles, ...chatFiles];

      for (const file of allFiles) {
        const part = await buildFilePart(file);
        if (part === null) continue;
        if (typeof part === "string") {
          // Text file — fold into text block
          textFragments.push(`--- Application: ${fresh.name} / ${file.filename} ---\n${part}`);
        } else {
          fileParts.push(part);
        }
      }
    }

    return { text: textFragments.join("\n\n"), fileParts };
  } catch (err) {
    logger.warn("buildApplicationsContext failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { text: "", fileParts: [] };
  }
}
