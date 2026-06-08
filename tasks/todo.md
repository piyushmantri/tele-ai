# FINAL — Tele application developer docs + in-app Docs page

## Task
Write a developer guide for building tele applications (hello world → DB integration → tele logging → debugging) and wire a "Docs" link into the web UI from the Applications page. The link opens an in-app Docs page that renders the guide.

## Critic concerns addressed (draft → final)
- **V1 (counseller is NOT in this repo)** — FIXED. The only in-repo example is `apps/server/applications/uptime-monitor/hook.ts` (a 9-line demo: root-level `hook.ts`, `getContext` only, NO manifest, NO `src/` — NOT installable as-is). All in-tele factual claims are now grounded in the loader source + uptime-monitor. Counseller (at the sibling path `~/spaps/counseller`, an externally-installable app) may be referenced ONCE as an "external example app," explicitly labelled as living outside this repo and not verifiable in-tree. No snippet is attributed to a counseller file as if it were in this repo.
- **V2 (phantom merged ctx)** — FIXED. Two separate ctx tables, one per runtime path, with an explicit "these do not overlap" note:
  - In-tele (`ai/applications.ts`, `ai/applicationSlash.ts`): `{ emit, emitTimeseries, storeResult, databaseUrl }`.
  - Standalone bot (`ai/applicationBotRunner.ts`): `{ databaseUrl, geminiApiKey, geminiModel }`.
- **V3 (getContext is 1-arg-valid)** — FIXED. Hello-world leads with `getContext(chatId)` (no ctx, exactly uptime-monitor); the optional `ctx?` second arg is introduced afterward as a widening.
- **V4 (ensureDb scope)** — FIXED. `ensureDb(databaseUrl)` documented ONLY in the standalone-bot section (called at `applicationBotRunner.ts:209-210`); not listed as a universal hook export.
- **V5 (acceptance cross-check files)** — FIXED. Acceptance #1 now cross-checks against `ai/applications.ts`, `ai/applicationSlash.ts`, `ai/applicationBotRunner.ts`, `applications/install.ts`, `applications/registry.ts`, `applications/uptime-monitor/hook.ts`.
- **Q1 (link strategy)** — RESOLVED to **option B**. Git remote is `github.com/piyushmantri/tele-ai.git` but visibility is unconfirmed and README still says `your-username/tele.git`, so a hardcoded GitHub URL (option A) is a guess that breaks for forks/private/offline. Option B has ZERO new deps: web build is already `tsc -b && vite build`, so `import md from "...building-applications.md?raw"` works; render in a `<pre>`. No markdown library.
- **Q2 (slash commands)** — ADDED. Section 7 is now a dedicated slash-command authoring walkthrough (manifest `slash_commands[]` + `handleSlashCommand` signature + the `CALL: /cmd {json}` AI-driven invocation path from `applicationBotRunner.ts:150-168`).
- **M1 (uptime-monitor not installable)** — when cited, the doc states it is a demo stub at the repo root and shows the REAL installable layout (`manifest.json` + `src/hook.ts`) separately, sourced from `install.ts`/`registry.ts`.
- **M3 (Docs link outside tab conditional)** — step calls out placing the link OUTSIDE the `tab === "installed"` conditional so it shows on both tabs.
- **M4 (logger path)** — VERIFIED: `apps/server/src/util/logger.ts` writes JSONL to `console` AND appends to `/tmp/spaps-server.log` (`LOG_FILE` const). Stated as fact, with the caveat that this is tele's host logger — app hooks must use `console.*`, not this.
- **M5 (tsc convention)** — typecheck uses `tsc -b` (matches web `build` script `tsc -b && vite build`).

## Files to touch
| File | Reason |
|---|---|
| `docs/building-applications.md` (NEW) | The developer guide. Markdown; readable in-repo AND imported raw by the web app. |
| `apps/web/src/pages/Docs.tsx` (NEW) | Renders the raw markdown (`?raw` import) inside a `<pre>` with the page's existing scroll/padding shell. No new deps. |
| `apps/web/src/App.tsx` | Add `<Route path="/applications/docs" element={<Docs />} />` and the import. |
| `apps/web/src/pages/Applications.tsx` | Add a "Docs" link (`<Link to="/applications/docs">` styled as a ghost Button) in the header, OUTSIDE the `tab==="installed"` conditional so it shows on both tabs. |

Note on the `?raw` import path: `docs/` is at repo root, web app is `apps/web/`. The import resolves via a relative path from the Docs.tsx file (e.g. `../../../../docs/building-applications.md?raw`) OR a vite alias. Execution step verifies vite resolves it; if the relative climb is fragile, fall back to copying nothing — instead add a `resolve.alias` or place the import path correctly. (Acceptance #3 covers this: build must pass.)

## Doc sections (outline — all grounded in real source)
1. **Overview** — two app types: `ai_only` (system prompt + KB, no code; `ai/applications.ts:121-132`) and `code` (`manifest.json` + `src/hook.ts`; `applications/install.ts`, `registry.ts`). Two runtime paths a code app can run in:
   - (a) **In-tele**: app assigned to a tele chat → `buildApplicationsContext` (`ai/applications.ts:110`) calls `getContext(chatId, ctx)`; slash via `ai/applicationSlash.ts`.
   - (b) **Standalone bot**: the app gets its OWN Telegram bot via `ai/applicationBotRunner.ts` (needs a `bot_config` row with `bot_token` + a per-app `database_url`).
2. **Hello World — ai_only** — dashboard only: slug, name, type `ai_only`, system prompt; assign to a chat. No code.
3. **Hello World — code app** — minimal installable repo: `manifest.json` at root (fields per `registry.ts:13-22`: slug/name/type/description/required_env_vars/system_prompt/knowledge_base/slash_commands) + `src/hook.ts` exporting `getContext(chatId)`. Lead with the exact 1-arg uptime-monitor body, then note uptime-monitor itself is a non-installable demo stub (root hook.ts, no manifest). Install via the Browse tab from a git URL or local path; slug in manifest MUST equal registry slug (`install.ts:156`); code type requires `src/hook.ts` (`install.ts:161-164`).
4. **The hook contract** — `getContext(chatId, ctx?)` (ctx optional; 1-arg valid — `ai/applications.ts:43-47`). The TWO ctx tables (V2). Defensive no-op pattern `const emit = ctx?.emit ?? (() => {})`. Return value is injected into the AI system instruction.
5. **Database integration** — per-app `database_url` set in the dashboard, injected via `ctx.databaseUrl` fresh every turn (never cache in module scope). Use `@neondatabase/serverless`. Migration pattern (lessons 2026-04-28): split `.sql` on `;`, run each via `sql(stmt, [])`, idempotent DDL (`IF NOT EXISTS`), track applied files in a `schema_migrations` table. `gen_random_uuid()` works without an extension on pg13+. Reference counseller (external example) for a fuller migrate.ts shape, labelled as out-of-repo.
6. **Tele logging & metrics** — inside a hook use `console.log`/`console.warn` only; do NOT import tele's `logger` (couples plugin to host; breaks the copy-to-applications install model — counseller hook header note 2). The host's own logger writes JSONL to console + `/tmp/spaps-server.log` (`util/logger.ts`), so hook stdout is captured there. Custom metrics: `ctx.emit(name)` (counter) and `ctx.emitTimeseries(name, value)` (240-sample ring) — names must match `^[a-z0-9_]{1,64}$` (`applicationMetrics.ts`); shown per-app on the Observability page. Emit closures arrive via ctx — never import `applicationMetrics` (PLUGIN BOUNDARY).
7. **Slash commands** — manifest `slash_commands[]` (name regex `^[a-z0-9_-]+$`, description ≤200; `registry.ts:8-11`) + `handleSlashCommand(cmd, args, chatId, ctx?)`. In-tele dispatch (`ai/applicationSlash.ts`) and the AI-driven `CALL: /cmd {json}` path the bot runner strips/executes (`applicationBotRunner.ts:150-168`). Note `ensureDb(databaseUrl)` optional export is called only by the standalone bot runner (V4).
8. **Debugging** — restart server after editing a hook (ESM module cache; matches Applications.tsx help text). Host warnings to grep in `/tmp/spaps-server.log`: `hook import failed`, `code app missing installed_path` (re-install from Browse), `bot_config does not exist` (benign — app isn't a bot app). GramJS `EntityLike` rejects `bigint` — use `Number(...)`/string for Telegram IDs (lessons 2026-04-28). Standalone smoke test: `tsx -e "import('./src/hook.ts').then(m => m.getContext('1').then(console.log))"`.

## Steps
- [ ] 1. Write `docs/building-applications.md` with sections 1–8. Ground every in-repo claim in the source files cited above; reference counseller only as an explicitly out-of-repo external example. No invented APIs.
- [ ] 2. Create `apps/web/src/pages/Docs.tsx`: `import md from "<path>/docs/building-applications.md?raw"`; render in a scrollable `<pre>` using the same outer shell as other pages (`h-full overflow-y-auto p-6`). Add a "← Back to Applications" `<Link to="/applications">`.
- [ ] 3. Edit `apps/web/src/App.tsx`: import `Docs`; add `<Route path="/applications/docs" element={<Docs />} />` near the other application routes (lines 61-62).
- [ ] 4. Edit `apps/web/src/pages/Applications.tsx`: add `<Link to="/applications/docs">` styled as a ghost Button in the header (lines 156-187), OUTSIDE the `tab === "installed"` conditional (M3) so it shows on both tabs.
- [ ] 5. Type-check + build web: `cd apps/web && npx tsc -b` exits 0; confirm the `?raw` markdown import resolves (run `npx vite build` or dev server). If the relative path is fragile, add a vite `resolve.alias` rather than duplicating the doc.
- [ ] 6. (verify phase) Load the dashboard, click Docs from both Installed and Browse tabs, confirm the guide renders and "Back" works; confirm doc has no broken internal references.

## Acceptance criteria
1. `docs/building-applications.md` exists with all 8 sections; every in-repo snippet/claim matches real APIs — cross-checked vs `ai/applications.ts`, `ai/applicationSlash.ts`, `ai/applicationBotRunner.ts`, `applications/install.ts`, `applications/registry.ts`, `applications/uptime-monitor/hook.ts`. No claim attributes an in-repo file to counseller.
2. Applications page renders a visible "Docs" link in the header on BOTH the Installed and Browse tabs; it navigates to `/applications/docs`, which renders the guide with a working back link.
3. `cd apps/web && npx tsc -b` exits 0 and `vite build` succeeds (proves the `?raw` import resolves); no new runtime dependency added to `apps/web/package.json`.
4. No server source files modified. Only `docs/building-applications.md` (new), `apps/web/src/pages/Docs.tsx` (new), `apps/web/src/App.tsx`, `apps/web/src/pages/Applications.tsx` changed.

## Risks
- **`?raw` import path resolution** across the `apps/web` → repo-root `docs/` boundary may need a vite alias; step 5 verifies and falls back to an alias (NOT doc duplication).
- **Doc drift**: snippets hardcode API shapes that may change. Mitigation: cite source file paths inline so readers can verify; keep snippets minimal.
- **Counseller reference**: it lives outside the repo and could diverge. Mitigation: label it clearly as an external example; keep all load-bearing claims on in-repo source.
- **Unstyled `<pre>` markdown** is plain-text-ish. Acceptable for v1 minimum-impact; a markdown renderer can be added later if the user wants rich rendering (out of scope, no dep now).
- **Brief named `applicationBotRunner.ts`** as "the hook system," but the primary in-tele host is `applications.ts`/`applicationSlash.ts`. Guide covers both paths to be correct.
