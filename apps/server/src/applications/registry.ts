import { z } from "zod";

// Anchored, no leading/trailing dash, no '..' — defense in depth for FS access.
// Exported so frontend AddApplicationForm can mirror the rule client-side
// (server is still source of truth).
export const slugRegex = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export const slashCommandManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  description: z.string().min(1).max(200),
});

export const manifestSchema = z.object({
  slug: z.string().min(1).regex(slugRegex),
  name: z.string().min(1),
  type: z.enum(["code", "ai_only"]),
  description: z.string().default(""),
  required_env_vars: z.array(z.string()).default([]),
  system_prompt: z.string().nullable().default(null),
  knowledge_base: z.string().nullable().default(null),
  slash_commands: z.array(slashCommandManifestSchema).default([]),
});

export type Manifest = z.infer<typeof manifestSchema>;

// Re-export so callers that previously imported APPLICATIONS_DIR from here
// (legacy registry.ts contract) can transition to the new install-path model
// via one import surface. INSTALLED_APPS_BASE = data/applications/ — the
// git-clone destination root; local-source plugins do NOT live under it.
export { INSTALLED_APPS_BASE } from "./install.js";
