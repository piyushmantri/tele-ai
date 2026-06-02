import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path, { join } from "node:path";
import { manifestSchema, type Manifest } from "./registry.js";

// All git-cloned plugins land under <cwd>/data/applications/<slug>/. The cwd
// is expected to be the monorepo root when tele is launched via `pnpm dev`
// from there (per .gitignore / tasks/todo.md). Local-source plugins keep
// their installed_path equal to the operator-supplied source_path verbatim,
// so this constant does not apply to them.
//
// .ts dev-only caveat (per lessons-2026-05-15): hook.ts is loaded by tsx via
// pathToFileURL(...).href + dynamic import(). A future tsc-built plugin would
// emit dist/hook.js and this loader would need to learn .js fallback — see
// applicationSlash.ts and ai/applications.ts for the matching call sites.
export const INSTALLED_APPS_BASE = join(process.cwd(), "data", "applications");

const CLONE_TIMEOUT_MS = 60_000;

async function fsExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function cloneRepo(url: string, dest: string): Promise<void> {
  await mkdir(INSTALLED_APPS_BASE, { recursive: true });
  const child = spawn("git", ["clone", url, dest]);
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      // Per critic M3: cleanup partial-clone dir BEFORE rejecting so the next
      // install attempt doesn't see garbage. Best-effort; we still throw the
      // timeout error even if cleanup fails.
      rm(dest, { recursive: true, force: true }).finally(() => {
        reject(new Error(`git clone timed out after ${CLONE_TIMEOUT_MS / 1000}s`));
      });
    }, CLONE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      rm(dest, { recursive: true, force: true }).finally(() => {
        reject(err);
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rm(dest, { recursive: true, force: true }).finally(() => {
          reject(
            new Error(`git clone failed (exit ${code}): ${stderr.trim()}`),
          );
        });
      } else {
        resolve();
      }
    });
  });
}

export interface RegistrySourceRow {
  slug: string;
  source_type: "git" | "local";
  source_url: string | null;
  source_path: string | null;
}

/**
 * Resolve the absolute on-disk install path for a registry row.
 * - local: validates the source_path is absolute, has no leading ~, exists.
 * - git:   clones into <INSTALLED_APPS_BASE>/<slug> if the dir is absent;
 *          returns the absolute path either way.
 * Throws on any validation / clone failure with an operator-readable message.
 */
export async function resolveInstalledPath(
  row: RegistrySourceRow,
): Promise<string> {
  if (row.source_type === "local") {
    const src = row.source_path;
    if (!src) {
      throw new Error("local registry row has no source_path");
    }
    if (src.startsWith("~")) {
      throw new Error(
        "source_path must be an absolute path (no `~`; Node does not expand tildes)",
      );
    }
    if (!path.isAbsolute(src)) {
      throw new Error("source_path must be an absolute path");
    }
    if (!(await fsExists(src))) {
      throw new Error(`source_path does not exist or is not readable: ${src}`);
    }
    return src;
  }

  if (row.source_type === "git") {
    const url = row.source_url;
    if (!url) {
      throw new Error("git registry row has no source_url");
    }
    const dest = join(INSTALLED_APPS_BASE, row.slug);
    if (!(await fsExists(dest))) {
      await cloneRepo(url, dest);
    }
    return dest;
  }

  throw new Error(`unknown source_type: ${row.source_type}`);
}

/**
 * Load and validate the plugin manifest from <installedPath>/manifest.json.
 * Throws on missing file or schema-validation failure.
 */
export async function loadManifestFrom(installedPath: string): Promise<Manifest> {
  const manifestPath = join(installedPath, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    throw new Error(
      `missing or unreadable manifest.json at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `invalid JSON in manifest.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return manifestSchema.parse(parsedJson);
}

/**
 * Validate an installed plugin against its manifest BEFORE the applications
 * row is inserted. Closes the silent-noop trap (per lessons-2026-05-20):
 * - code-type plugins must have src/hook.ts on disk.
 * - manifest.slug MUST equal the registry row's slug (per critic V2),
 *   otherwise PluginSlot's window.__TELE_PLUGIN_UI__[registry_slug] lookup
 *   would return undefined and the Settings tab would hang.
 */
export async function validateInstalledPlugin(
  installedPath: string,
  manifest: Manifest,
  registrySlug: string,
): Promise<void> {
  if (manifest.slug !== registrySlug) {
    throw new Error(
      `manifest slug '${manifest.slug}' does not match registry slug '${registrySlug}'`,
    );
  }
  if (manifest.type === "code") {
    const hookPath = join(installedPath, "src", "hook.ts");
    if (!(await fsExists(hookPath))) {
      throw new Error(`missing required file: src/hook.ts at ${hookPath}`);
    }
  }
}
