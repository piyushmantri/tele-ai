import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { access, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path, { join } from "node:path";
import { makeSql } from "../../db/index.js";
import {
  createApplication,
  deleteApplication,
  getApplication,
  getApplicationByRegistrySlug,
  listApplications,
  listApplicationsForChat,
  listAssignmentsForApplication,
  removeAssignment,
  setAssignment,
  updateApplication,
} from "../../db/repos/applications.js";
import {
  countFiles,
  createFile,
  deleteFile,
  getFileMeta,
  listAppFiles,
  saveFileLocally,
} from "../../db/repos/applicationFiles.js";
import { listKundaliMatches } from "../../db/repos/kundaliMatches.js";
import { ensureAppMigrated } from "../../ai/appDatabase.js";
import {
  createRegistryRow,
  deleteRegistryRow,
  getRegistryRowBySlug,
  listRegistryRows,
} from "../../db/repos/applicationRegistry.js";
import { getChatById } from "../../db/repos/chats.js";
import { eventBus } from "../../util/eventBus.js";
import { logger } from "../../util/logger.js";
import {
  loadManifestFrom,
  resolveInstalledPath,
  validateInstalledPlugin,
} from "../../applications/install.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES_PER_APP = 20;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
]);

const slugRegex = /^[a-z0-9_-]+$/;

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(slugRegex, "lowercase alphanumeric, dash, underscore only"),
  name: z.string().min(1),
  type: z.enum(["code", "ai_only"]),
  description: z.string().optional().default(""),
  system_prompt: z.string().nullable().optional(),
  knowledge_base: z.string().nullable().optional(),
  database_url: z.string().nullable().optional(),
  is_global_default: z.boolean().optional(),
});

const updateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(slugRegex, "lowercase alphanumeric, dash, underscore only")
    .optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  system_prompt: z.string().nullable().optional(),
  knowledge_base: z.string().nullable().optional(),
  database_url: z.string().nullable().optional(),
  is_global_default: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// XOR refinement (per critic V8): git rows must have source_url + URL-shaped,
// local rows must have source_path + absolute + no leading `~`. Per-violation
// messages so the dashboard can show the operator exactly what's wrong.
const createRegistrySchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(slugRegex, "lowercase alphanumeric, dash, underscore only"),
    source_type: z.enum(["git", "local"]),
    source_url: z.string().min(1).optional(),
    source_path: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.source_type === "git") {
      if (!val.source_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_url"],
          message: "source_url is required when source_type='git'",
        });
      }
      if (val.source_path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_path"],
          message: "source_path must be empty when source_type='git'",
        });
      }
    } else if (val.source_type === "local") {
      const p = val.source_path;
      if (!p) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_path"],
          message: "source_path is required when source_type='local'",
        });
      } else {
        if (p.startsWith("~")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["source_path"],
            message:
              "source_path must be absolute (no `~`; Node does not expand tildes)",
          });
        } else if (!path.isAbsolute(p)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["source_path"],
            message: "source_path must be an absolute path",
          });
        }
      }
      if (val.source_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_url"],
          message: "source_url must be empty when source_type='local'",
        });
      }
    }
  });

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown };
  return e.code === "23505";
}

async function fsExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function registerApplicationRoutes(
  app: FastifyInstance,
): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE + 1024 } });

  app.get("/api/applications", async () => {
    return { applications: await listApplications() };
  });

  // --- Registry (DB-backed plugin catalog) ---
  // Registered BEFORE parametric `:id` routes for defensive clarity even
  // though Fastify resolves static paths first. See migration 0022 for the
  // schema; see applications/install.ts for path resolution and validation.

  app.get("/api/applications/registry", async () => {
    const installed = await listApplications();
    const installedSlugs = new Set(
      installed.map((a) => a.registry_slug).filter((s): s is string => !!s),
    );
    const rows = await listRegistryRows();
    const entries: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      // Per-row try/catch isolation (lessons-2026-05-15): one bad source
      // (path-missing, clone-fails, malformed manifest) must not blank out
      // the whole catalog.
      try {
        const installedPath = await resolveInstalledPath(row);
        const manifest = await loadManifestFrom(installedPath);
        const hasHook = await fsExists(join(installedPath, "src", "hook.ts"));
        entries.push({
          slug: row.slug,
          name: manifest.name,
          type: manifest.type,
          description: manifest.description,
          required_env_vars: manifest.required_env_vars,
          system_prompt: manifest.system_prompt,
          knowledge_base: manifest.knowledge_base,
          has_hook: hasHook,
          installed: installedSlugs.has(row.slug),
          slash_commands: manifest.slash_commands,
          source_type: row.source_type,
          source_url: row.source_url,
          source_path: row.source_path,
          installed_path: installedPath,
        });
      } catch (err) {
        const message = errMsg(err);
        logger.warn("registry entry load failed", {
          slug: row.slug,
          err: message,
        });
        // Partial entry so the dashboard can show the row + the error
        // chip instead of silently hiding the registry catalog row.
        entries.push({
          slug: row.slug,
          name: row.slug,
          type: "code",
          description: "",
          required_env_vars: [],
          system_prompt: null,
          knowledge_base: null,
          has_hook: false,
          installed: installedSlugs.has(row.slug),
          slash_commands: [],
          source_type: row.source_type,
          source_url: row.source_url,
          source_path: row.source_path,
          installed_path: null,
          error: message,
        });
      }
    }
    return { entries };
  });

  app.post("/api/applications/registry", async (req, reply) => {
    // Body is required here; zod's missing-body error is the intended UX
    // (per lessons-2026-05-20).
    const body = createRegistrySchema.parse(req.body);
    try {
      const row = await createRegistryRow({
        slug: body.slug,
        source_type: body.source_type,
        source_url: body.source_url ?? null,
        source_path: body.source_path ?? null,
      });
      reply.code(201);
      return { entry: row };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `registry slug '${body.slug}' already exists` };
      }
      throw err;
    }
  });

  app.delete("/api/applications/registry/:slug", async (req, reply) => {
    const { slug } = z
      .object({ slug: z.string().min(1).regex(slugRegex) })
      .parse(req.params);
    const installedApp = await getApplicationByRegistrySlug(slug);
    if (installedApp) {
      reply.code(400);
      return {
        error: "uninstall the application first before removing the registry entry",
      };
    }
    await deleteRegistryRow(slug);
    reply.code(204);
    return null;
  });

  app.post("/api/applications/install/:registrySlug", async (req, reply) => {
    const { registrySlug } = z
      .object({ registrySlug: z.string().min(1).regex(slugRegex) })
      .parse(req.params);
    // Bodyless POST friendliness (per lessons-2026-05-20): the web client may
    // omit Content-Type so req.body arrives undefined; `?? {}` keeps zod happy.
    const body = z
      .object({ is_global_default: z.boolean().optional() })
      .parse(req.body ?? {});

    const row = await getRegistryRowBySlug(registrySlug);
    if (!row) {
      reply.code(404);
      return { error: "registry entry not found" };
    }

    // Resolve install path (clone for git, validate for local). Errors here
    // are environmental (clone failure, missing local dir) — 500 with the
    // operator-readable message.
    let installedPath: string;
    try {
      installedPath = await resolveInstalledPath(row);
    } catch (err) {
      reply.code(500);
      return { error: errMsg(err) };
    }

    // Manifest read+parse failures are operator-fixable config errors — 400.
    let manifest;
    try {
      manifest = await loadManifestFrom(installedPath);
    } catch (err) {
      reply.code(400);
      return { error: errMsg(err) };
    }

    // Slug-equality + hook.ts presence check BEFORE INSERT (per critic V2 +
    // lessons-2026-05-20 silent-noop trap).
    try {
      await validateInstalledPlugin(installedPath, manifest, registrySlug);
    } catch (err) {
      reply.code(400);
      return { error: errMsg(err) };
    }

    // Type-specific invariants — symmetric with POST /api/applications.
    if (manifest.type === "ai_only") {
      const sp = manifest.system_prompt;
      if (typeof sp !== "string" || sp.trim() === "") {
        reply.code(400);
        return {
          error: "ai_only registry entry missing non-empty system_prompt",
        };
      }
    }

    try {
      const application = await createApplication({
        slug: manifest.slug,
        name: manifest.name,
        type: manifest.type,
        description: manifest.description,
        system_prompt: manifest.system_prompt,
        knowledge_base: manifest.knowledge_base,
        database_url: null,
        is_global_default: body.is_global_default ?? false,
        registry_slug: manifest.slug,
        installed_path: installedPath,
      });
      eventBus.emit({ type: "application:changed", payload: { application } });
      reply.code(201);
      return { application };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: "application slug or name already exists" };
      }
      throw err;
    }
  });

  app.delete("/api/applications/install/:registrySlug", async (req, reply) => {
    const { registrySlug } = z
      .object({ registrySlug: z.string().min(1).regex(slugRegex) })
      .parse(req.params);
    const existing = await getApplicationByRegistrySlug(registrySlug);
    if (!existing) {
      reply.code(404);
      return {
        error: `no application installed from registry slug '${registrySlug}'`,
      };
    }
    // FK ON DELETE CASCADE on application_chats.application_id and
    // application_files.application_id (migrations 0019, 0020) handles
    // assignments and uploaded files.
    //
    // Uninstall preserves on-disk plugin source (per lessons-2026-05-20):
    // we do NOT rm -rf the installed dir. For git-cloned plugins the
    // operator's edits survive; for local-source plugins it's the operator's
    // own repo and untouching it is the only safe move. Reinstall picks up
    // whatever is on disk.
    await deleteApplication(existing.id);
    logger.info("application uninstalled (source preserved on disk)", {
      slug: existing.slug,
      preserved_path: existing.installed_path,
    });
    eventBus.emit({
      type: "application:changed",
      payload: { application: existing, deleted: true },
    });
    reply.code(204);
    return null;
  });

  app.get("/api/applications/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    return { application };
  });

  app.post("/api/applications", async (req, reply) => {
    const body = createSchema.parse(req.body);
    if (body.type === "ai_only") {
      const sp = body.system_prompt;
      if (typeof sp !== "string" || sp.trim() === "") {
        reply.code(400);
        return { error: "ai_only applications require a non-empty system_prompt" };
      }
    }
    try {
      const application = await createApplication({
        slug: body.slug,
        name: body.name,
        type: body.type,
        description: body.description,
        system_prompt: body.system_prompt ?? null,
        knowledge_base: body.knowledge_base ?? null,
        database_url: body.database_url ?? null,
        is_global_default: body.is_global_default ?? false,
      });
      eventBus.emit({ type: "application:changed", payload: { application } });
      return { application };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `application slug or name already exists` };
      }
      throw err;
    }
  });

  app.put("/api/applications/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    const current = await getApplication(id);
    if (!current) {
      reply.code(404);
      return { error: "not found" };
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "slug") &&
      current.type === "code" &&
      body.slug !== current.slug
    ) {
      reply.code(400);
      return {
        error:
          "slug is immutable for code-type applications (would orphan the installed plugin path)",
      };
    }

    if (current.type === "ai_only") {
      const nextSp = Object.prototype.hasOwnProperty.call(body, "system_prompt")
        ? body.system_prompt
        : current.system_prompt;
      if (typeof nextSp !== "string" || nextSp.trim() === "") {
        reply.code(400);
        return { error: "ai_only applications require a non-empty system_prompt" };
      }
    }

    try {
      const application = await updateApplication(id, body);
      if (!application) {
        reply.code(404);
        return { error: "not found" };
      }
      eventBus.emit({ type: "application:changed", payload: { application } });
      return { application };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `application slug or name already exists` };
      }
      throw err;
    }
  });

  app.patch("/api/applications/:id/enabled", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const application = await updateApplication(id, { enabled });
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    eventBus.emit({ type: "application:changed", payload: { application } });
    return { application };
  });

  app.delete("/api/applications/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getApplication(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteApplication(id);
    eventBus.emit({
      type: "application:changed",
      payload: { application: existing, deleted: true },
    });
    return { ok: true };
  });

  app.get("/api/applications/:id/assignments", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    return { assignments: await listAssignmentsForApplication(id) };
  });

  app.put("/api/applications/:id/chats/:chatId", async (req, reply) => {
    const { id, chatId } = z
      .object({ id: z.string().uuid(), chatId: z.string().uuid() })
      .parse(req.params);
    const body = z
      .object({ enabled: z.boolean().optional() })
      .parse(req.body ?? {});
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "application not found" };
    }
    const chat = await getChatById(chatId);
    if (!chat) {
      reply.code(404);
      return { error: "chat not found" };
    }
    try {
      const assignment = await setAssignment(id, chatId, body.enabled ?? true);
      eventBus.emit({
        type: "application_chat:changed",
        payload: { application_id: id, chat_id: chatId },
      });
      return { assignment };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: "assignment already exists" };
      }
      throw err;
    }
  });

  app.delete("/api/applications/:id/chats/:chatId", async (req, reply) => {
    const { id, chatId } = z
      .object({ id: z.string().uuid(), chatId: z.string().uuid() })
      .parse(req.params);
    await removeAssignment(id, chatId);
    eventBus.emit({
      type: "application_chat:changed",
      payload: { application_id: id, chat_id: chatId, removed: true },
    });
    return { ok: true };
  });

  app.get("/api/chats/:id/applications", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const chat = await getChatById(id);
    if (!chat) {
      reply.code(404);
      return { error: "chat not found" };
    }
    return { applications: await listApplicationsForChat(id) };
  });

  // --- Per-application profile (operator-edited via dashboard or `/set-profile`) ---
  // Single file at <installed_path>/profile.json (per decision #6 in todo.md).
  // No more seed-vs-override split: for local-source installs the operator IS
  // editing the source repo's file; for git-clone installs the operator is
  // editing the cloned working copy. Uninstall preserves the file on disk
  // (per lessons-2026-05-20).

  app.get("/api/applications/:id/profile", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!application.installed_path) {
      reply.code(400);
      return { error: "application has no installed_path" };
    }
    const overridePath = join(application.installed_path, "profile.json");
    try {
      const raw = await readFile(overridePath, "utf8");
      return { profile: JSON.parse(raw), source: "override" };
    } catch {
      return { profile: null, source: "none" };
    }
  });

  app.put("/api/applications/:id/profile", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    if (application.type !== "code") {
      reply.code(400);
      return { error: "profile editing requires a code-type application" };
    }
    if (!application.installed_path) {
      reply.code(400);
      return { error: "application has no installed_path" };
    }

    // Inline schema scoped to the route — hook re-validates on read.
    // Caps mirror the hook's set-profile handler (notes 1000, others 200).
    const profileSchema = z.object({
      name: z.string().min(1).max(200).trim(),
      dob: z.string().min(1).max(200).trim(),
      gender: z.string().min(1).max(200).trim(),
      tob: z.string().max(200).trim().optional(),
      pob: z.string().max(200).trim().optional(),
      tz: z.string().max(200).trim().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      notes: z.string().max(1000).trim().optional(),
    });

    // `req.body` (NOT `req.body ?? {}`) — body is required here; zod's
    // missing-body error is the intended UX (lessons-2026-05-20).
    const body = profileSchema.parse(req.body);

    // Trim-empty-to-NULL at the route boundary (lessons-2026-05-12).
    const profile = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== "" && v != null),
    );

    const overridePath = join(application.installed_path, "profile.json");
    // No mkdir(dirname(...)) — installed_path is expected to exist for a
    // validated install. If a future failure mode is "dir was deleted after
    // install", the operator's fix is to reinstall, not for this route to
    // silently re-materialize the directory.
    await writeFile(overridePath, JSON.stringify(profile, null, 2));

    return { profile, source: "override" };
  });

  // --- Plugin UI bundle (streams the plugin's dist/ui.js as JS) ---
  // Per critic V1 the auth allowlist in api/index.ts lets unauthenticated
  // requests reach this handler. Per critic V10+M9 every error branch ALSO
  // returns application/javascript so the browser console reads a JS comment
  // instead of "Unexpected token <" from a JSON error body. Do NOT set
  // Content-Length — let Fastify chunk the stream.

  app.get("/api/applications/:id/ui.js", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    reply.type("application/javascript");
    const application = await getApplication(id);
    if (!application) {
      return reply.send("/* application not found */");
    }
    if (!application.installed_path) {
      return reply.send("/* no installed_path */");
    }
    const uiPath = join(application.installed_path, "dist", "ui.js");
    if (!(await fsExists(uiPath))) {
      return reply.send(
        "/* dist/ui.js not built — run 'npm install && npm run build' in the plugin repo */",
      );
    }
    const stream = createReadStream(uiPath);
    // After headers are sent we can't switch to a JS-comment body cleanly
    // (per critic V10). Log and let Fastify close the connection on error.
    stream.on("error", (e) => {
      logger.warn("ui.js stream error", {
        app_id: id,
        err: e instanceof Error ? e.message : String(e),
      });
    });
    return reply.send(stream);
  });

  // --- File endpoints (app-level only; chat-level files arrive via Telegram) ---

  app.get("/api/applications/:id/files", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    return { files: await listAppFiles(id) };
  });

  app.post("/api/applications/:id/files", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }

    const data = await req.file();
    if (!data) {
      reply.code(400);
      return { error: "no file uploaded" };
    }

    const mimeType = data.mimetype;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      reply.code(400);
      return {
        error: `unsupported file type: ${mimeType}. Allowed: images, PDF, text/markdown/csv`,
      };
    }

    const buf = await data.toBuffer();
    if (buf.byteLength > MAX_FILE_SIZE) {
      reply.code(400);
      return { error: "file exceeds 10 MB limit" };
    }

    const count = await countFiles(id, null);
    if (count >= MAX_FILES_PER_APP) {
      reply.code(400);
      return { error: `application already has ${MAX_FILES_PER_APP} app-level files (limit reached)` };
    }

    const filename = data.filename || "upload";
    const localPath = await saveFileLocally(id, null, filename, buf);
    const file = await createFile({
      applicationId: id,
      chatId: null,
      filename,
      mimeType,
      sizeBytes: buf.byteLength,
      localPath,
    });

    reply.code(201);
    return { file };
  });

  app.delete("/api/applications/:id/files/:fileId", async (req, reply) => {
    const { id, fileId } = z
      .object({ id: z.string().uuid(), fileId: z.string().uuid() })
      .parse(req.params);
    const meta = await getFileMeta(fileId);
    if (!meta || meta.application_id !== id) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteFile(fileId);
    return { ok: true };
  });

  app.get("/api/applications/:id/matches", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!application.database_url) return { matches: [] };
    const matches = await listKundaliMatches(application.database_url);
    return { matches };
  });

  app.get("/api/applications/:id/hook", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    if (application.type !== "code") {
      return { content: null };
    }
    if (!application.installed_path) {
      reply.code(404);
      return { content: null };
    }
    try {
      const hookPath = join(application.installed_path, "src", "hook.ts");
      const content = await readFile(hookPath, "utf8");
      return { content };
    } catch {
      return { content: null };
    }
  });

  app.get("/api/applications/:id/bot-config", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) { reply.code(404); return { error: "not found" }; }
    if (!application.database_url || !application.installed_path) {
      return { configured: false, bot_token_masked: null, target_chat_id: null, last_error: null, last_connected_at: null };
    }
    try {
      await ensureAppMigrated(application.installed_path, application.database_url);
      const sql = makeSql(application.database_url);
      const rows = await sql`SELECT bot_token, target_chat_id, last_error, last_connected_at FROM bot_config WHERE id = 'default'`;
      const row = rows[0] ?? null;
      if (!row) return { configured: false, bot_token_masked: null, target_chat_id: null, last_error: null, last_connected_at: null };
      const token = row.bot_token as string | null;
      return {
        configured: Boolean(token),
        bot_token_masked: token ? "•••" + token.slice(-4) : null,
        target_chat_id: row.target_chat_id,
        last_error: row.last_error,
        last_connected_at: row.last_connected_at,
      };
    } catch (err) {
      logger.warn("bot-config GET failed", { application_id: id, err: String(err) });
      reply.code(500); return { error: "failed to read bot config" };
    }
  });

  app.put("/api/applications/:id/bot-config", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) { reply.code(404); return { error: "not found" }; }
    if (!application.database_url || !application.installed_path) {
      reply.code(400); return { error: "no database_url configured for this application" };
    }
    const body = req.body as Record<string, unknown>;
    try {
      await ensureAppMigrated(application.installed_path, application.database_url);
      const sql = makeSql(application.database_url);
      const current = (await sql`SELECT bot_token, target_chat_id FROM bot_config WHERE id = 'default'`)[0] ?? {};
      const newToken = Object.prototype.hasOwnProperty.call(body, "bot_token") ? (body.bot_token ?? null) : (current.bot_token ?? null);
      const newChatId = Object.prototype.hasOwnProperty.call(body, "target_chat_id") ? (body.target_chat_id ?? null) : (current.target_chat_id ?? null);
      await sql(`INSERT INTO bot_config (id, bot_token, target_chat_id, updated_at) VALUES ('default', $1, $2, now()) ON CONFLICT (id) DO UPDATE SET bot_token = EXCLUDED.bot_token, target_chat_id = EXCLUDED.target_chat_id, updated_at = now()`, [newToken, newChatId]);
      return { ok: true };
    } catch (err) {
      logger.warn("bot-config PUT failed", { application_id: id, err: String(err) });
      reply.code(500); return { error: "failed to save bot config" };
    }
  });

  app.post("/api/applications/:id/bot-config/test", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) { reply.code(404); return { error: "not found" }; }
    if (!application.database_url || !application.installed_path) {
      reply.code(400); return { ok: false, error: "no database_url configured" };
    }
    try {
      await ensureAppMigrated(application.installed_path, application.database_url);
      const sql = makeSql(application.database_url);
      const rows = await sql`SELECT bot_token FROM bot_config WHERE id = 'default'`;
      const token = rows[0]?.bot_token as string | null;
      if (!token) { reply.code(400); return { ok: false, error: "No bot token saved. Save a token first." }; }
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json() as { ok: boolean; result?: { username?: string }; description?: string };
      if (data.ok) {
        await sql`UPDATE bot_config SET last_connected_at = now(), last_error = null WHERE id = 'default'`;
        return { ok: true, bot_username: data.result?.username };
      } else {
        const errMsg = data.description ?? "Unknown error";
        await sql`UPDATE bot_config SET last_error = ${errMsg} WHERE id = 'default'`;
        return { ok: false, error: errMsg };
      }
    } catch (err) {
      logger.warn("bot-config test failed", { application_id: id, err: String(err) });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/applications/:id/ping-db", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!application.database_url) {
      reply.code(400);
      return {
        ok: false,
        latency_ms: 0,
        error: "no database_url configured for this application",
      };
    }
    const start = Date.now();
    try {
      const sql = makeSql(application.database_url);
      const rows = await sql`SELECT 1 as ok`;
      const latency = Date.now() - start;
      const ok =
        Array.isArray(rows) && rows.length === 1 && rows[0]?.ok === 1;
      return { ok, latency_ms: latency };
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "connection failed";
      const message = rawMessage.replace(
        /postgres(?:ql)?:\/\/[^\s'"]*/gi,
        "postgres://[redacted]",
      );
      logger.warn("ping-db failed", { application_id: id, message });
      return { ok: false, latency_ms: Date.now() - start, error: message };
    }
  });

  // GET /api/applications/:id/git-status
  // Runs `git fetch` then counts commits the local clone is behind the remote.
  // Only valid for git-sourced apps with an installed_path.
  app.get("/api/applications/:id/git-status", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) { reply.code(404); return { error: "not found" }; }
    if (!application.installed_path) {
      reply.code(400); return { error: "no installed_path" };
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const cwd = application.installed_path;

    try {
      await exec("git", ["fetch", "--quiet"], { cwd });
      const { stdout: behindRaw } = await exec(
        "git", ["rev-list", "--count", "HEAD..@{u}"], { cwd }
      );
      const behindBy = parseInt(behindRaw.trim(), 10);
      return { updatesAvailable: behindBy > 0, behindBy };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("git-status failed", { application_id: id, message });
      reply.code(500);
      return { error: message };
    }
  });

  // POST /api/applications/:id/update
  // Runs `git pull --ff-only` in the installed_path.
  app.post("/api/applications/:id/update", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const application = await getApplication(id);
    if (!application) { reply.code(404); return { error: "not found" }; }
    if (!application.installed_path) {
      reply.code(400); return { error: "no installed_path" };
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const cwd = application.installed_path;

    try {
      const { stdout } = await exec("git", ["pull", "--ff-only"], { cwd });
      logger.info("git pull succeeded", { application_id: id, stdout: stdout.trim() });
      eventBus.emit({ type: "application:changed", payload: { application } });
      return { ok: true, output: stdout.trim() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("git pull failed", { application_id: id, message });
      reply.code(500);
      return { ok: false, error: message };
    }
  });

  app.get("/api/applications/:id/chats", async (req, reply) => {
    const { id } = req.params as { id: string };
    const application = await getApplication(id);
    if (!application?.database_url) { reply.code(404); return { chats: [] }; }
    try {
      const sql = makeSql(application.database_url);
      const chats = await sql(
        `SELECT
           chat_id AS tg_chat_id,
           COUNT(*)::int AS message_count,
           MAX(created_at) AS last_at,
           LEFT(
             (SELECT content FROM chat_messages m2
              WHERE m2.chat_id = m.chat_id ORDER BY created_at DESC LIMIT 1),
             120
           ) AS last_preview
         FROM chat_messages m
         GROUP BY chat_id
         ORDER BY MAX(created_at) DESC`,
        [],
      );
      return { chats };
    } catch {
      return { chats: [] };
    }
  });

  app.get("/api/applications/:id/chats/:tgChatId", async (req, reply) => {
    const { id, tgChatId } = req.params as { id: string; tgChatId: string };
    const application = await getApplication(id);
    if (!application?.database_url) { reply.code(404); return { error: "Not found" }; }
    try {
      const sql = makeSql(application.database_url);
      const messages = await sql(
        `SELECT id, chat_id AS tg_chat_id, role, content, created_at
         FROM chat_messages
         WHERE chat_id = $1
         ORDER BY created_at ASC`,
        [tgChatId],
      );
      return { messages };
    } catch {
      reply.code(500);
      return { error: "Failed to query app database" };
    }
  });
}
