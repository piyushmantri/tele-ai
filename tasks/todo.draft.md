# DRAFT — Tele application developer docs + Docs link

## Task
Write a developer guide for building tele applications (hello world → DB integration → tele logging → debugging) and wire a "Docs" link into the web UI from the Applications page.

## Lessons applied
- **Neon serverless driver constraints** (lessons 2026-04-28): the DB section MUST tell authors to split multi-statement `.sql` files on `;` and run each via `sql(stmt, [])`; no `sql.unsafe`/`sql.query`/multi-statement strings. Mirror counseller's `db/migrate.ts` (canonical working example).
- **GramJS `EntityLike` rejects `bigint`** (lessons 2026-04-28): debugging section notes Telegram IDs must be `Number(...)`/string, not `BigInt`, if an app touches GramJS directly.
- **`.ts` hook is dev-only / dynamic-import by literal `hook.ts`** (lessons-2026-05-15; repeated in `applications.ts`, `install.ts`, `applicationSlash.ts`): hooks load via `pathToFileURL(.../src/hook.ts).href` under tsx, and editing a hook needs a server restart (ESM module cache) — keep wording consistent with the existing Applications.tsx help text.
- **Hook must not import tele internals** (counseller hook header note 2): depend only on `node:*`, relative siblings, `@neondatabase/serverless`, nanoid; use `console.warn`/`console.log`, NOT tele's `logger`.
- **Metrics emit closures arrive via ctx, never imported** (`applicationMetrics.ts` PLUGIN BOUNDARY): document the defensive `const emit = ctx?.emit ?? (() => {})` pattern.

## Files to touch
| File | Reason |
|---|---|
| `docs/building-applications.md` (NEW) | The developer guide itself. Markdown, readable in-repo. |
| `apps/web/src/pages/Applications.tsx` | Add a "Docs" link/button in the page header. |

## Open decision: how does the "Docs" link surface the content?
Draft picks **A**, flagged for critic:
- **A. External link to GitHub-hosted `docs/building-applications.md`** via `target="_blank"`. Zero new routes/deps/server work. Risk: hardcoded repo URL; broken for local-only checkouts.
- **B. New in-app route `/applications/docs`** rendering the markdown. Needs a markdown-renderer dep (none in web `package.json` currently) + Route in `App.tsx` + vite `?raw` import. More moving parts.
- **C. Static `.md` in `apps/web/public/`** served raw. No deps but duplicates the doc and renders unstyled.

Leaning A for minimum-impact. Will confirm with critic whether in-repo-only link is acceptable or B is wanted.

## Doc sections (outline)
1. **Overview** — `ai_only` (system prompt + KB, no code) vs `code` (`manifest.json` + `src/hook.ts`). Two runtime paths: (a) assigned to a tele chat → `buildApplicationsContext` calls `getContext(chatId, ctx)`; (b) standalone per-app Telegram bot via `applicationBotRunner` (needs `bot_config` row + `database_url`).
2. **Hello World (ai_only)** — create via dashboard: slug/name/type/system prompt; assign to a chat. No code.
3. **Hello World (code app)** — minimal repo: `manifest.json` (slug/name/type/required_env_vars/slash_commands, cite zod `manifestSchema`) + `src/hook.ts` exporting `getContext`. Install via Browse tab (git URL or local path). Slug must match manifest↔registry; `src/hook.ts` required for code type.
4. **The hook contract** — signatures: `getContext(chatId, ctx?)`, `handleSlashCommand(cmd, args, chatId, ctx?)`, optional `ensureDb(databaseUrl)`. `ctx` fields: `emit`, `emitTimeseries`, `storeResult`, `databaseUrl`, `geminiApiKey`, `geminiModel`. Defensive no-op ctx pattern.
5. **Database integration** — per-app `database_url` from dashboard, injected via `ctx.databaseUrl` fresh each turn (never cache in module scope). `@neondatabase/serverless`. Migration pattern: split on `;`, run each via `sql(stmt,[])`, idempotent DDL (`IF NOT EXISTS`), `schema_migrations` table. Reference counseller `db/migrate.ts` + `db/client.ts`. `gen_random_uuid()` works without an extension on pg13+.
6. **Tele logging & metrics** — inside a hook use `console.log`/`console.warn` (host captures stdout JSONL → `/tmp/spaps-server.log` + console). Do NOT import tele's `logger`. Custom metrics via `ctx.emit(name)` (counter) and `ctx.emitTimeseries(name, value)` (240-sample ring); names match `^[a-z0-9_]{1,64}$`; show on Observability page per app.
7. **Debugging** — restart server after hook edits (ESM cache). Host warnings to grep for: `hook import failed`, `code app missing installed_path` (re-install from Browse), `bot_config does not exist` (benign). Tail `/tmp/spaps-server.log`. GramJS no-`bigint` caveat. Standalone smoke test: `tsx -e "import('./src/hook.ts').then(...)"`.

## Steps
- [ ] 1. Resolve Docs-link decision (A/B/C) with critic; default A.
- [ ] 2. Write `docs/building-applications.md` covering sections 1–7, grounding every snippet in the real counseller app + ctx contract (no invented APIs).
- [ ] 3. Edit `apps/web/src/pages/Applications.tsx`: add a "Docs" link in the header. Option A → `<a href={DOCS_URL} target="_blank" rel="noreferrer">` styled to match header buttons, placed near "+ Add application".
- [ ] 4. Type-check web: `cd apps/web && npx tsc -b` exits 0.
- [ ] 5. (verify phase) Confirm link renders + points at the doc; doc has no broken internal references.

## Acceptance criteria
1. `docs/building-applications.md` exists with all 7 sections; every snippet matches real APIs — cross-checked vs `applications.ts`, `applicationBotRunner.ts`, `registry.ts`, counseller `hook.ts`/`db/*`.
2. Applications page renders a visible "Docs" link in the header that opens the guide.
3. `cd apps/web && npx tsc -b` exits 0; no new runtime deps (if option A).
4. No tele source files other than `Applications.tsx` modified; no server code touched.

## Risks
- **Doc drift**: cite source file paths so readers can verify; keep snippets minimal.
- **Option A hardcodes a repo URL** that may be wrong/private. Confirm URL or fall back to B/C.
- **Option B adds a markdown-renderer dep** — violates minimum-impact unless user wants in-app docs.
- **Wrong "hook system" file**: brief named `applicationBotRunner.ts`, but the primary in-tele hook host is `applications.ts`. Guide must cover BOTH paths.
