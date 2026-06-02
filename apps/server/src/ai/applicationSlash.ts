import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Chat } from "@tele/shared";
import {
  getActiveApplicationsForChat,
  getApplication,
} from "../db/repos/applications.js";
import { loadManifestFrom } from "../applications/install.js";
import { recordAppSlash, makeAppEmit } from "./applicationMetrics.js";
import { makeStoreResult } from "./appDatabase.js";
import { logger } from "../util/logger.js";

// Dynamic-import call site mirrors loadCodeAppContext in
// apps/server/src/ai/applications.ts. SAME .ts-extension dev-only caveat
// (lessons-2026-05-15): future "compile to .js" migration must touch BOTH
// this file AND ai/applications.ts AND applications/install.ts at once.
interface CodeAppHookContext {
  emit?: (name: string, value?: number) => void;
  emitTimeseries?: (name: string, value: number) => void;
  storeResult?: (data: Record<string, unknown>) => Promise<void>;
  databaseUrl?: string | null;
}

interface CodeAppHookModule {
  // Optional 4th ctx arg widens the signature (lessons-2026-05-21): hooks
  // ignoring it still satisfy the type; new hooks receive a per-call `emit`
  // and (since 2026-05-27) `emitTimeseries` for typed line-chart metrics.
  handleSlashCommand?: (
    cmd: string,
    args: string,
    chatId: string,
    ctx?: CodeAppHookContext,
  ) => Promise<string> | string;
}

export async function tryApplicationSlashCommand(
  chat: Chat,
  name: string,
  args: string,
): Promise<{ handled: boolean; reply?: string; appSlug?: string }> {
  try {
    const apps = await getActiveApplicationsForChat(chat.id);

    const matchedSlugs: string[] = [];
    let firstResult: { reply: string; appSlug: string } | null = null;

    for (const app of apps) {
      try {
        // Two-layer enabled re-check (lessons-2026-05-15): the resolver returns
        // a fresh list but we re-fetch to confirm the row is still enabled at
        // dispatch time.
        const fresh = await getApplication(app.id);
        if (!fresh || !fresh.enabled) continue;
        if (!fresh.installed_path) continue;

        // Read the manifest fresh from the installed plugin's repo (single
        // source of truth — same file the install route validated against).
        const manifest = await loadManifestFrom(fresh.installed_path);

        const matching = manifest.slash_commands.find((sc) => sc.name === name);
        if (!matching) continue;

        matchedSlugs.push(fresh.slug);

        if (firstResult !== null) {
          // Conflict: another app already handled this command. Keep counting
          // for the warn log, but do NOT invoke this app's hook.
          continue;
        }

        const hookPath = pathToFileURL(
          join(fresh.installed_path, "src", "hook.ts"),
        ).href;
        const mod = (await import(hookPath)) as CodeAppHookModule;
        if (typeof mod.handleSlashCommand !== "function") continue;

        const start = Date.now();
        let out: string | undefined;
        try {
          const ctx: CodeAppHookContext = {
            ...makeAppEmit(fresh.slug),
            storeResult: makeStoreResult(fresh.id, fresh.database_url, fresh.installed_path),
            databaseUrl: fresh.database_url ?? null,
          };
          const raw = await mod.handleSlashCommand(name, args, chat.id, ctx);
          out = typeof raw === "string" ? raw : "";
          try { recordAppSlash(fresh.slug, name, true); } catch {
            // metrics must never throw out of the hook caller
          }
        } catch (err) {
          try { recordAppSlash(fresh.slug, name, false); } catch {
            // metrics must never throw out of the hook caller
          }
          throw err;
        }
        firstResult = {
          reply: out ?? "",
          appSlug: fresh.slug,
        };
      } catch (err) {
        // Per-item isolation (lessons-2026-05-15): one misbehaving plugin
        // must not poison the dispatch loop for siblings.
        logger.warn("app slash command failed", {
          slug: app.slug,
          name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (matchedSlugs.length > 1) {
      logger.warn("multiple apps register same slash command name", {
        name,
        slugs: matchedSlugs,
      });
    }

    if (firstResult) {
      return {
        handled: true,
        reply: firstResult.reply,
        appSlug: firstResult.appSlug,
      };
    }
    return { handled: false };
  } catch (err) {
    logger.warn("tryApplicationSlashCommand failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { handled: false };
  }
}
