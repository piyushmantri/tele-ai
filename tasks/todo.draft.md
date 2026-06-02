# Counseller (Admission Counseling) Tele Application — Final Plan

## Task
Build a tele code-type plugin at `~/spaps/counseller` that acts as a conversational AI counselor over Telegram. It asks the student about exams attended (JEE Main, JEE Advanced, MHT-CET, BITSAT, VITEEE, KCET, AP-EAMCET, WBJEE), captures expectations (branch, location, fees, tier), stores everything in a per-app Neon Postgres DB (URL injected by tele), and recommends colleges/branches the student is realistically eligible for.

Counseller has **two operating modes** sharing the same Neon DB and recommender:
- **Plugin mode** (primary): installed into tele; tele owns Telegram delivery and invokes the hook's `getContext`/`handleSlashCommand`.
- **Standalone bot mode** (NEW): the operator configures a Telegram bot token + target chat id in the standalone web dashboard; the standalone server starts a Telegram polling loop and routes incoming updates to the same `getContext`/`handleSlashCommand` entrypoints (plus a small LLM reply path for free-text turns). Useful when running counseller on its own against a group/channel without a tele host.

A secondary standalone web UI lets operators view/manage the data and configure the standalone bot.

## Lessons applied
From `~/spaps/tele/tasks/lessons.md` and the tele runtime conventions in `apps/server/src/ai/applications.ts`, `appDatabase.ts`, `applicationSlash.ts`:

- **Neon serverless driver constraints** (2026-04-28): Use ONLY tagged-template `` sql`...` `` and direct-call `sql(text, params)` — NO `sql.unsafe`, NO `sql.query`, NO multi-statement strings. Migration runner must split the `.sql` file on `;`, strip `--` comments, and execute each statement via `sql(stmt, [])`. All DDL `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` since there is no whole-file transaction.
- **`packageManager: "pnpm@X.Y.Z"`** (2026-04-28): Counseller is a sibling repo to tele/kundali (single npm package, no workspace). Plain `npm` — no `packageManager` field needed. If pnpm is ever added, pin a real semver.
- **Plugin hook isolation** (existing kundali-match pattern, see hook.ts comments 1-6): Do NOT import from outside `~/spaps/counseller/src/` — no tele internals, no shared packages. The hook is dynamic-imported via `pathToFileURL(...)` so installed copies must remain self-contained. Use `console.warn` (not a logger import) for hook-side errors; a copied-in logger is for the standalone web/server only.
- **Hook `ctx` defensive defaults** (existing kundali pattern): `const emit = ctx?.emit ?? (() => {}); const emitTs = ctx?.emitTimeseries ?? (() => {}); const storeResult = ctx?.storeResult;` -- and now `const databaseUrl = ctx?.databaseUrl;` (NEW). All closures must be no-ops when ctx is undefined so the hook can also be invoked from the standalone CLI / web for testing.
- **Unique-violation -> 409, not 500** (2026-04-30): Neon raises Postgres error code `23505`. The `preferences(chat_id)` PK exercises this when slash command attempts a duplicate `/set-preferences` create. Catch and return a friendly message string from the slash command; from the web API, return HTTP 409.
- **Mirror create-time validation in update routes** (2026-04-30): The `update_preferences` and `update_attempt` paths must re-validate the post-merge row, not trust the partial.
- **`enabled`/visibility re-check at every consumer** (2026-04-30): `colleges.active` defaults true; recommender SQL filters `active=true`; the web detail route also filters `active=true` (404 if not).
- **FK to internal id, not external** (2026-04-30): `exam_attempts.chat_id` and `preferences.chat_id` reference the Telegram chat id (BIGINT, stored as TEXT here since the hook receives `chatId: string`). The `branches.college_id` and `cutoffs.branch_id` FKs use internal nanoid PKs, never college short-names.
- **Distinguish "key absent" from "key present, value null"** (2026-04-30): All update paths (slash `/set-preferences` partial JSON and web PATCH) use `Object.prototype.hasOwnProperty.call(body, key)` to decide whether to write; `max_fees_lakhs: null` clears the cap, key absent leaves it alone.
- **Tool/list-response trimming + list-then-get split** (2026-04-30): `/recommend` slash command and `GET /api/chats/:chatId/recommendations` return only `{college_name, branch_name, exam_used, student_value, cutoff_value, margin, fit_reasons[]}`. Full college payload only via `GET /api/colleges/:id`.
- **Slash command soft-rejecting parse failures** (2026-05-02): Slash command handler must distinguish "unknown command" (return `"Unknown command."`) from "command matched, args invalid" (return usage text). Tele's outer dispatcher only invokes us when our manifest claims a slash command; we still need to handle `cmd !== "add-exam" && cmd !== "set-preferences" && cmd !== "recommend"` defensively.
- **Optional `opts` param with `??` fallback** (2026-05-02): The hook's exported `getContext(chatId, ctx?)` and `handleSlashCommand(cmd, args, chatId, ctx?)` keep their existing positional signatures; the new `ctx.databaseUrl` is added inside the context object, not a new positional arg.
- **`String.replaceAll(literal)` is fine for simple templates** (2026-05-02): The "outstanding questions" section in `getContext` is plain string assembly — no template engine needed.
- **Webhook ordering / always-200** (2026-05-04): Not directly relevant (no webhooks of our own; Telegram delivery is tele's responsibility). The list/static ordering sub-lesson DOES apply: in the standalone web server, register explicit `/api/*` routes BEFORE `@fastify/static` from `web/dist`.
- **`BIGINT` Telegram chat ids: persist as text-safe** (2026-05-04): The hook gets `chatId` as a `string` from tele. Store it as `TEXT` in counseller's Neon tables (avoids any Number(2^53) concern) -- counseller never feeds chat ids back into GramJS, so the `EntityLike` constraint doesn't apply.

Existing tele code patterns referenced (NOT lessons, but conventions we must follow):
- `~/spaps/kundali/src/hook.ts` lines 35-58 — the existing `CodeAppHookContext` shape, and the `pathToFileURL(hook.ts)` dynamic-import contract. Counseller's hook matches that signature exactly, plus the new `databaseUrl` field.
- `~/spaps/tele/apps/server/src/ai/applications.ts:35-47` — current `CodeAppHookContext` interface. The TELE-SIDE CHANGE is widening this and the `loadCodeAppContext` call site to pass `databaseUrl: fresh.database_url`. Same widening in `applicationSlash.ts:81` (`storeResult: makeStoreResult(...)` neighborhood gets a `databaseUrl: fresh.database_url` field).
- `~/spaps/tele/apps/server/src/ai/appDatabase.ts:45-62` — `makeStoreResult` currently hard-codes the `kundali_matches` JSONB table. **Counseller does NOT use `storeResult`** — it bypasses the generic JSONB sink entirely and uses the raw `databaseUrl` to manage its own structured schema (multiple tables, migrations, FKs). The `storeResult` callback remains available as a fallback (no-op for counseller).

Not applied (out of scope): GramJS/Telegram-client lessons (tele owns delivery), Gemini SDK function-call loop lessons (counseller's hook returns plain text instructions for the model, no in-hook tool loop), multimodal/temp-file/Pencil lessons.

## Tech stack
- **Hook runtime** (the code tele dynamic-imports): Node 20+, TypeScript via `tsx` (matches kundali-match's `(1) DEV-ONLY .ts ASSUMPTION`), `@neondatabase/serverless` for the per-app DB, nanoid for ids. ZERO external imports beyond node:* + `@neondatabase/serverless` + `nanoid` so the installed copy stays drop-in.
- **Standalone web** (secondary, for operator inspection + bot config): React 18 + Vite 5 + TypeScript, Tailwind 3, React Router 6, TanStack Query 5. Backed by a Fastify server in the same repo that reuses the Neon connection (URL via `DATABASE_URL` env var).
- **Standalone server**: Fastify 5, `@neondatabase/serverless`, zod, `@google/generative-ai` (LLM reply path for the standalone bot's free-text turns; same dep tele already uses). Reads `DATABASE_URL` and `GEMINI_API_KEY` from env (operator points DATABASE_URL at the same Neon DB tele injected into the hook).
- **Standalone bot** (NEW): no extra runtime dep — raw `getUpdates` long-polling via global `fetch` against `https://api.telegram.org/bot<token>/...`. Avoids pulling in `node-telegram-bot-api` (one less dep to keep current; tele itself uses GramJS which is overkill for a single-bot listener).
- **Layout** (kundali-style):
  ```
  ~/spaps/counseller/
    manifest.json            # tele plugin descriptor
    package.json             # root npm package; deps for hook + web + server
    tsconfig.json
    .gitignore
    README.md
    src/
      hook.ts                # tele's dynamic-import target (getContext + handleSlashCommand)
      types.ts               # shared types (Profile, ExamAttempt, Recommendation, ...)
      engine/
        recommender.ts       # eligibility + margin + fit-reasons (pure functions)
        prompts.ts           # PERSONA, METHODOLOGY, next-question generator
      db/
        client.ts            # neon(url) singleton per url
        migrate.ts           # split-and-apply migration runner
        migrations/
          0001_init.sql
          0002_seed_colleges.sql
        repos/
          students.ts        # chat-id-keyed; created lazily on first interaction
          examAttempts.ts
          preferences.ts
          colleges.ts
      util/
        logger.ts            # JSON-lines {info,warn,error} -- STANDALONE ONLY; hook uses console.warn
        errors.ts            # wrapPgError (23505 -> 409, 23503 -> 400)
    web/                     # standalone React UI (operator dashboard)
      package.json
      vite.config.ts
      tsconfig.json
      src/
        main.tsx
        App.tsx
        lib/api.ts
        lib/queryKeys.ts
        pages/Students.tsx
        pages/StudentDetail.tsx
        pages/Colleges.tsx
        pages/CollegeDetail.tsx
        pages/BotConfig.tsx    # NEW: standalone-bot config (token, target chat, test, status)
        components/Layout.tsx
    server/                  # standalone Fastify server (serves the web UI + JSON API + bot loop)
      package.json
      tsconfig.json
      src/
        index.ts             # boots HTTP server AND (if configured) Telegram polling loop
        bot/
          poller.ts          # getUpdates long-poll loop
          dispatch.ts        # update -> handleSlashCommand / LLM reply path
          llm.ts             # Gemini call for free-text turns (uses getContext output as system prompt)
        api/
          index.ts
          routes/students.ts
          routes/exams.ts
          routes/preferences.ts
          routes/recommendations.ts
          routes/colleges.ts
          routes/botConfig.ts # GET/PUT /api/config/bot + POST /api/config/bot/test
    data/                    # bot session etc; .gitignored
  ```
- **Why this stack**:
  - vs. SQLite: tele plugins are installed by the host into `apps/server/applications/<slug>/`; multiple tele installations could share the same plugin source while pointing at different Neon DBs. SQLite-on-disk would couple the plugin's data location to its install path — wrong shape.
  - vs. Postgres-via-pg: `@neondatabase/serverless` matches tele's `appDatabase.ts` and is what `ctx.databaseUrl` will point at (Neon-compatible URL).
  - vs. importing tele's logger across packages: violates the `(2) DO NOT import from outside this folder or tele internals` rule that kundali-match's hook documents. Copy verbatim.

## Operating modes (plugin vs standalone bot)
Counseller has one DB and one set of business logic (recommender, repos, prompts). What differs is who delivers Telegram messages to it:

| Mode | Activated when | Telegram delivery | DB URL source | Hook entrypoints |
|---|---|---|---|---|
| **Plugin** | Installed under `tele/apps/server/applications/counseller/` and tele's host process is running | tele's GramJS client | `ctx.databaseUrl` (injected per turn) | tele calls `getContext` + `handleSlashCommand` directly |
| **Standalone bot** | `DATABASE_URL` env set AND `bot_config.bot_token` row populated AND counseller's own `server/` process is running | counseller's `server/src/bot/poller.ts` (`getUpdates` long-poll) | `process.env.DATABASE_URL` | `dispatch.ts` calls `getContext` + `handleSlashCommand` from `../../src/hook.js`, plus `llm.ts` for free-text Gemini replies |

Mode-distinction rules:
- The standalone server checks `bot_config` on every boot AND on every PUT to `/api/config/bot`. If a token is present and reachable (passes `getMe`), the poller starts; otherwise the HTTP API still runs (operator can still configure).
- When counseller is installed into tele, the standalone server is typically NOT running. If both are running against the same Neon DB pointing at the same target chat, both will reply — operator's responsibility to avoid this; web UI shows a warning banner "Plugin mode AND standalone bot configured for chat X — disable one." (Banner is best-effort: it queries tele's `applications` table only if running in the same Postgres; otherwise omitted.)
- The web dashboard's `BotConfig` page is always reachable. README documents that the page is meaningless if counseller will only ever be used as a tele plugin (operator can ignore it).
- Polling cadence: 30s long-poll timeout, no offset persisted across restarts beyond what `getUpdates` already de-dupes via the `update_id`/offset pattern (loop persists `last_offset` in memory; restart re-fetches whatever's pending and skips already-handled updates via `bot_config.last_processed_update_id` written transactionally per batch).
- The poller is a single goroutine-style async loop with backoff: on transport error, sleep 5s and retry; on auth error (401), stop the poller and surface "invalid token" in `bot_config.last_error` (operator sees it in the dashboard).
- Free-text (non-slash) updates: dispatch builds the same `[COUNSELOR-PERSONA] + [STUDENT-PROFILE] + [METHODOLOGY] + [NEXT-STEP]` block from `getContext`, calls Gemini with the user's message + that system prompt, and posts the reply via `sendMessage`. Gemini-tool-call autonomy: V1 standalone bot does NOT expose function-calling for the slash commands; instead the system prompt instructs the AI to format its response as `CALL: /add-exam {...}` markers that `dispatch.ts` parses and executes server-side. This keeps the hook unchanged and avoids re-implementing tele's tool loop.

## Tele-side change (required prerequisite, but implemented inside `counseller` plan for visibility)
The team-lead asked counseller's hook to receive `ctx.databaseUrl`. Today, `apps/server/src/ai/applications.ts:35-65` defines `CodeAppHookContext` as `{emit?, emitTimeseries?, storeResult?}` and never passes the raw `databaseUrl`. The required tele edits are:
1. `apps/server/src/ai/applications.ts`: widen `CodeAppHookContext` with `databaseUrl?: string | null`; in `loadCodeAppContext`, pass `databaseUrl: databaseUrl ?? null` alongside the existing `storeResult`.
2. `apps/server/src/ai/applicationSlash.ts:~81`: same widening — pass `databaseUrl: fresh.database_url ?? null`.
3. No migration to tele's own schema — `applications.database_url` already exists (the team-lead's brief confirms it; we can verify by grepping the schema before edit).

These are TWO small additive edits in tele's repo. The counseller plan calls them out and the executor must do them as Step 0; without them, counseller's hook will get `ctx.databaseUrl === undefined` and fall back to "DB not configured" mode (which is acceptable as a fail-safe but won't satisfy acceptance criteria).

## Counselor flow (how the AI behaves end-to-end)
On every chat turn:
1. `getContext(chatId, ctx)` loads the student profile from Neon (or `null` if first turn). Calls `ctx.databaseUrl` once per turn — Neon driver caches the connection per url.
2. Returns a system-prompt snippet with three parts:
   - `[COUNSELOR-PERSONA]` — proactive, asks one or two questions at a time, never overloads the user.
   - `[STUDENT-PROFILE]` — formatted current state: exams added (with year/marks/rank/percentile), preferences set or not, missing fields.
   - `[NEXT-STEP]` — explicit instruction: if any required exam detail is missing, ask the most natural next question; if profile is complete and prefs are set, suggest running `/recommend`.
3. The AI replies in natural language. When the user provides exam details in free text ("My JEE Main 2024 was 94.7 percentile, GEN category"), the AI is instructed to call `/add-exam {...}` to persist it. Same for `/set-preferences {...}`.
4. `/recommend` runs the recommender and returns a trimmed list of (college, branch, exam used, margin, reasons).

The slash commands are the persistence API; the natural-language conversation is the UX. The AI bridges the two — same pattern as `/set-profile` / `/match` in kundali-match, generalized to a multi-turn capture flow.

## Exam unit families (load-bearing for the recommender)
Eight V1 exams across three unit families:

| Exam | Unit | "Best" means | Eligibility | Margin (positive = comfortable) |
|---|---|---|---|---|
| JEE_MAIN | percentile (0-100, higher better) | MAX(percentile) | `student.percentile >= cutoff.percentile` | `student.percentile - cutoff.percentile` |
| JEE_ADVANCED | rank (1..N, lower better) | MIN(rank) | `student.rank <= cutoff.rank` | `(cutoff.rank - student.rank) / cutoff.rank` |
| MHT_CET | percentile | MAX(percentile) | same as JEE_MAIN | same |
| BITSAT | marks (0-390) | MAX(marks) | `student.marks >= cutoff.marks` | `(student.marks - cutoff.marks) / cutoff.marks` |
| VITEEE | rank | MIN(rank) | same as JEE_ADV | same |
| KCET | rank | MIN(rank) | same | same |
| AP_EAMCET | rank | MIN(rank) | same | same |
| WBJEE | rank | MIN(rank) | same | same |

(NEET reserved in the enum but not seeded in V1 since the team-lead's brief is engineering admissions.)

**Exam-to-college eligibility map** (enforced by which cutoff rows exist, not by code):
- IITs: JEE_ADVANCED only.
- NITs / IIITs / GFTIs: JEE_MAIN only (state-quota allocations exist in real life but V1 seeds the AI-pool / all-India pool for simplicity).
- BITS Pilani/Goa/Hyderabad: BITSAT only.
- COEP/VJTI/PICT/Maharashtra govt: MHT_CET (with `home_state_advantage=true` for Maharashtra residents).
- VIT Vellore/Chennai: VITEEE only.
- RVCE/BMSCE/PESU Karnataka: KCET (with `home_state_advantage=true` for Karnataka residents).
- IIIT Hyderabad / JNTU / AU Engg: AP_EAMCET (with `home_state_advantage=true` for AP residents).
- Jadavpur / Bengal Engg colleges: WBJEE (with `home_state_advantage=true` for WB residents).

The recommender does NOT need an explicit map; it joins `cutoffs` on `(exam_name, year, category)` matching one of the student's attempts and filters via `active=true`. Coverage is enforced by the seed data, not by code branches.

## Fit-reason taxonomy (closed set)
| Code | Means |
|---|---|
| `within_cutoff_comfortable` | Margin >= 15% (rank/marks family) or >= 5 points (percentile family) |
| `within_cutoff_tight` | Eligible but below the comfortable threshold |
| `matches_preferred_branch` | Branch name case-insensitive substring-matches any in `preferences.preferred_branches` |
| `in_preferred_location` | College state in `preferences.preferred_locations` |
| `in_home_state` | College state == `preferences.home_state` AND cutoff has `home_state_advantage=true` |
| `under_fee_cap` | `colleges.annual_fees_lakhs <= preferences.max_fees_lakhs` (when cap set) |
| `matches_tier` | `colleges.tier <= preferences.tier_preference_max` |

Sort: `(eligible DESC, fit_reasons.length DESC, margin DESC)`, slice to limit (default 20).

## Files to touch
All paths under `~/spaps/counseller/` unless prefixed `tele:`.

### Tele-side (prerequisite Step 0)
- `tele: apps/server/src/ai/applications.ts` — widen `CodeAppHookContext` to include `databaseUrl?: string | null`; in `loadCodeAppContext`, pass `databaseUrl: databaseUrl ?? null` in the ctx object next to `storeResult`.
- `tele: apps/server/src/ai/applicationSlash.ts` — same widening + same field at the slash dispatcher's ctx construction site (~line 81).

### Counseller root
- `manifest.json` — `{slug: "counseller", name: "Counseller", type: "code", description: "...", required_env_vars: [], system_prompt: null, knowledge_base: null, slash_commands: [{name: "add-exam", description: "Add an exam attempt. Args: JSON with exam_name, year, marks?/rank?/percentile?, category"}, {name: "set-preferences", description: "Set or update branch/location/fees/tier preferences. Args: JSON partial — only fields present are written."}, {name: "recommend", description: "Compute and return top college recommendations based on stored exams and preferences."}, {name: "list-exams", description: "List all stored exam attempts for this chat."}, {name: "clear", description: "Delete this chat's stored exams and preferences (start over)."}]}`.
- `package.json` — deps: `@neondatabase/serverless`, `nanoid`. devDeps: `tsx`, `typescript`, `@types/node`. Scripts: `dev:server` (tsx watch server), `dev:web` (vite), `dev` (concurrently both), `build`, `start`. Pin `engines.node: ">=20"`.
- `tsconfig.json` — strict, ES2022, moduleResolution: bundler.
- `.gitignore` — `node_modules/`, `dist/`, `web/dist/`, `data/`, `.env`.
- `README.md` — install-into-tele instructions, env vars (`DATABASE_URL` for standalone), data caveat, recommender caveat, slash command reference.

### src/hook.ts (the tele dynamic-import target)
- Self-contained: node:* imports + `@neondatabase/serverless` + `nanoid` + relative `./engine/*` + `./db/*` + `./types.js`.
- Top-of-file comment block mirrors kundali's lines 1-58: dev-only .ts assumption, no-cross-import rule, profile resolution (now: "read fresh from Neon every getContext call"), methodology drift caveat (now: "cutoff data is a snapshot — see migrations/0002_seed_colleges.sql"), slash-command behavior, ctx contract documenting the new `databaseUrl` field.
- `interface HookContext { emit?; emitTimeseries?; storeResult?; databaseUrl?: string | null; }` — matches tele's widened type structurally.
- `export async function getContext(chatId: string, ctx?: HookContext): Promise<string>`:
  1. `const databaseUrl = ctx?.databaseUrl;`
  2. If no databaseUrl: return `[COUNSELOR-PERSONA] + [STATUS] "Counseller is not configured: tele did not inject a database_url. Operator should set the application's database_url in the dashboard." + [METHODOLOGY-LITE]`.
  3. Else: `await ensureMigrated(databaseUrl)` (idempotent; tracked via `schema_migrations` table); fetch student profile via `getStudentBundle(databaseUrl, chatId)`; format as `[STUDENT-PROFILE]`; compute outstanding questions; assemble `[COUNSELOR-PERSONA] + [STUDENT-PROFILE] + [METHODOLOGY] + [NEXT-STEP]`.
  4. Emit metrics: `emit("getcontext_called")`, `emit("profile_loaded"|"profile_missing")`, `emitTs("getcontext_duration_ms", elapsed)`.
- `export async function handleSlashCommand(cmd, args, chatId, ctx?): Promise<string>`:
  - If no databaseUrl: return `"Counseller is not configured (no database_url). Ask the operator to set it."` for any write command; permit `list-exams` and `recommend` to return empty results gracefully.
  - Dispatch on `cmd`: `add-exam` -> `handleAddExam(databaseUrl, chatId, args, emit)`; `set-preferences` -> `handleSetPrefs(databaseUrl, chatId, args, emit)`; `recommend` -> `handleRecommend(databaseUrl, chatId, emit, emitTs)`; `list-exams` -> `handleListExams(databaseUrl, chatId, emit)`; `clear` -> `handleClear(databaseUrl, chatId, emit)`; default -> `"Unknown command."`.
  - Each handler validates JSON (where applicable), wraps DB calls in try/catch mapping `err.code === "23505"` -> friendly "already exists" string, returns plain text suitable for Telegram. Fire-and-forget `storeResult` is NOT used (counseller writes structured rows itself).

### src/types.ts
- `ExamName = "JEE_MAIN" | "JEE_ADVANCED" | "MHT_CET" | "BITSAT" | "VITEEE" | "KCET" | "AP_EAMCET" | "WBJEE" | "NEET"` (NEET reserved; no V1 cutoff seeds).
- `Category = "GEN" | "OBC" | "SC" | "ST" | "EWS"`.
- `ExamAttempt = { id, chat_id, exam_name, year, marks?, rank?, percentile?, category, created_at }`.
- `Preferences = { chat_id, preferred_branches: string[], preferred_locations: string[], max_fees_lakhs: number|null, tier_preference_max: 1|2|3, home_state: string|null, updated_at }`.
- `Recommendation = { college_id, college_name, branch_name, exam_used, student_value, cutoff_value, margin, fit_reasons: string[] }`.
- `College`, `Branch`, `Cutoff` mirror schema columns.

### src/engine/recommender.ts
- `export function recommend(student: {attempts, prefs}, cutoffsJoined): Recommendation[]`.
- Pure functions only (no DB calls — caller loads inputs and passes them in; makes unit testing trivial).
- Per-unit-family `eligibleAndMargin(family, studentValue, cutoffValue): {eligible, margin}` dispatch.
- Most-recent-year tie-break: per `exam_name`, pick the attempt with `MAX(year)`; within that year, pick the unit-best.
- Build `fit_reasons` per the closed set; sort `(eligible DESC, fit_reasons.length DESC, margin DESC)`; slice to limit.

### src/engine/prompts.ts
- `PERSONA_TEXT` (counselor persona constant).
- `METHODOLOGY_TEXT` (brief overview of how recommendations are computed; mirrors README data caveat).
- `formatStudentProfile(bundle): string`.
- `nextStepInstruction(bundle): string` — examines bundle, returns one of: "ask which exams the student has appeared for", "ask for the JEE Main percentile and year (already mentioned the exam but missing details)", "ask for preferences", "profile complete — suggest /recommend".

### src/db/client.ts
- `import { neon, type NeonQueryFunction } from "@neondatabase/serverless";`
- `const cache = new Map<string, NeonQueryFunction<false, false>>();`
- `export function getClient(url: string): NeonQueryFunction<false, false>` — cache-or-create.

### src/db/migrate.ts
- `export async function ensureMigrated(url: string): Promise<void>`:
  1. `sql = getClient(url)`.
  2. `await sql\`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())\`;`
  3. Read filenames from `src/db/migrations/` (use `import.meta.url` + `readdir`), sort.
  4. Query applied set.
  5. For each unapplied file: read text, strip `--` comments, split on `;`, filter non-empty, run each via `sql(stmt + ";", [])`, then `INSERT INTO schema_migrations`. Lesson 2026-04-28.
- In-process memo of "this url has been migrated" to skip the read-applied-set query on subsequent `getContext` calls within one process lifetime.

### src/db/migrations/0001_init.sql
- `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`
- `students(chat_id TEXT PRIMARY KEY, name TEXT, category TEXT NOT NULL DEFAULT 'GEN', created_at TIMESTAMPTZ DEFAULT now())` — keyed on Telegram chat_id directly; no separate student id (one chat = one student in this counselor model).
- `exam_attempts(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES students(chat_id) ON DELETE CASCADE, exam_name TEXT NOT NULL, year INTEGER NOT NULL, marks REAL, rank INTEGER, percentile REAL, category TEXT NOT NULL DEFAULT 'GEN', created_at TIMESTAMPTZ DEFAULT now(), CHECK (marks IS NOT NULL OR rank IS NOT NULL OR percentile IS NOT NULL))`
- `preferences(chat_id TEXT PRIMARY KEY REFERENCES students(chat_id) ON DELETE CASCADE, preferred_branches JSONB NOT NULL DEFAULT '[]', preferred_locations JSONB NOT NULL DEFAULT '[]', max_fees_lakhs REAL, tier_preference_max INTEGER NOT NULL DEFAULT 3, home_state TEXT, updated_at TIMESTAMPTZ DEFAULT now())` — PK on chat_id exercises the 23505/409 path.
- `colleges(id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, state TEXT NOT NULL, city TEXT, tier INTEGER NOT NULL DEFAULT 3, annual_fees_lakhs REAL, active BOOLEAN NOT NULL DEFAULT true)`
- `branches(id TEXT PRIMARY KEY, college_id TEXT NOT NULL REFERENCES colleges(id) ON DELETE CASCADE, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true)`
- `cutoffs(id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE, exam_name TEXT NOT NULL, category TEXT NOT NULL, year INTEGER NOT NULL, cutoff_marks REAL, cutoff_rank INTEGER, cutoff_percentile REAL, home_state_advantage BOOLEAN NOT NULL DEFAULT false, round TEXT, source_note TEXT)`
- Indices: `cutoffs(exam_name, year, category)`, `cutoffs(branch_id)`, `exam_attempts(chat_id)`, `branches(college_id)`.

### src/db/migrations/0003_bot_config.sql (NEW — standalone bot mode)
- `bot_config(id TEXT PRIMARY KEY DEFAULT 'default', bot_token TEXT, target_chat_id TEXT, webhook_secret TEXT, last_processed_update_id BIGINT NOT NULL DEFAULT 0, last_error TEXT, last_connected_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (id = 'default'))`
- Single-row config table (the `CHECK (id = 'default')` enforces only one row; operator UPSERTs on the `default` key).
- Seed one row: `INSERT INTO bot_config (id) VALUES ('default') ON CONFLICT DO NOTHING;` so GET always returns a baseline row even before first save.
- Header comment: `-- bot_config is consumed by counseller/server only. The hook (plugin mode) ignores this table entirely. Token is stored plaintext per project decision; future work could move to secrets manager.`

### src/db/migrations/0002_seed_colleges.sql
- ~30 colleges spanning all 8 exam families, ~3 branches each, 2 categories (GEN, OBC), 2 years (2023, 2024). Realistic eligibility map enforced via WHICH cutoff rows are inserted:
  - **JEE_ADVANCED rows** for 8 IITs x 3 branches (CSE/EE/ME) x 2 categories x 2 years = 96 rows.
  - **JEE_MAIN rows** for 8 NITs + 4 IIITs + 2 GFTIs x 3 branches x 2 x 2 = 168 rows.
  - **BITSAT rows** for BITS Pilani/Goa/Hyderabad x 3 branches x 2 x 2 = 36 rows.
  - **MHT_CET rows** for COEP/VJTI/PICT x 3 branches x 2 x 2 = 36 rows, `home_state_advantage=true`.
  - **VITEEE rows** for VIT Vellore/Chennai x 3 x 2 x 2 = 24 rows.
  - **KCET rows** for RVCE/BMSCE/PES x 3 x 2 x 2 = 36 rows, `home_state_advantage=true`.
  - **AP_EAMCET rows** for IIIT-H (non-JEE branches)/JNTU/AU x 3 x 2 x 2 = 36 rows, `home_state_advantage=true`.
  - **WBJEE rows** for Jadavpur/IIEST x 3 x 2 x 2 = 24 rows, `home_state_advantage=true`.
  - **Total ~456 cutoff rows across ~30 colleges and 8 exams.**
- All inserts use `INSERT INTO ... ON CONFLICT (id) DO NOTHING` keyed on slug ids (`iit_bombay`, `nit_trichy`, `bits_pilani`, `coep_pune`, `vit_vellore`, `rvce_bangalore`, `iiit_hyd`, `jadavpur`, ...).
- Header comment: `-- Snapshot of public 2023 & 2024 closing ranks/marks/percentiles from JoSAA last round (national exams) and respective state CET counseling boards (state exams). To revise, write a NEW migration (000N_seed_update.sql) — DO NOT edit this file (applied migrations are skipped).`
- Document the exam-to-college eligibility in the file's header comment so a verifier can spot-check.

### src/db/repos/students.ts
- `getStudent(sql, chatId)`, `ensureStudent(sql, chatId)` (insert on conflict do nothing — lazy creation on first interaction).
- `getStudentBundle(sql, chatId): {student, attempts, prefs}` — three queries in parallel via `Promise.all`.

### src/db/repos/examAttempts.ts
- `listAttempts(sql, chatId)`, `createAttempt(sql, chatId, dto)` (generates nanoid id; CHECK constraint enforces at-least-one), `deleteAttempt(sql, chatId, id)`. No update — the slash command flow is "add or replace via clear"; retakes are first-class as separate rows.

### src/db/repos/preferences.ts
- `getPrefs(sql, chatId)`, `createPrefs(sql, chatId, dto)` (INSERT — raises 23505 if exists), `upsertPrefs(sql, chatId, dto)` (INSERT ON CONFLICT UPDATE for the slash-command create-or-update path; merges using `hasOwnProperty` semantics in the application layer before issuing the SQL — so absent keys retain DB values, explicit nulls clear).

### src/db/repos/colleges.ts
- `listColleges(sql, {active=true})`, `getCollege(sql, id)` (filters `active=true`, returns null otherwise — caller 404s).
- `getCollegeWithBranchesAndCutoffs(sql, id)` for detail page.
- `loadCutoffsForExams(sql, exams: ExamName[], categories: Category[], years: number[]): Cutoff[]` joined with branches + colleges, filtering active rows — single query feeding the recommender.

### src/util/logger.ts
- **Copy verbatim from `~/spaps/tele/apps/server/src/util/logger.ts`** (per team-lead point #3). Same JSON-lines format, same `{info, warn, error}` interface. Used by `server/` and `web/` server-side code; NOT used by `src/hook.ts` (the hook uses `console.warn` per kundali's rule (2)).

### src/util/errors.ts
- `httpError(code, message)`.
- `wrapPgError(err): {status, body}` — `23505` -> 409 friendly message; `23503` -> 400; else rethrow.

### server/* (standalone Fastify dashboard backend + standalone bot loop)
- `server/package.json` — fastify, @fastify/static, @neondatabase/serverless, zod, @google/generative-ai. Scripts: dev, build, start.
- `server/src/index.ts` — boots on `PORT` (default 8788, to not collide with tele's 8787 in dev); reads `DATABASE_URL` from env; on boot calls `ensureMigrated(DATABASE_URL)`; registers routes BEFORE `@fastify/static` from `../web/dist` (production only) BEFORE `setNotFoundHandler` — lesson 2026-05-04. After Fastify is `ready()`, kicks off `startBotIfConfigured()` from `bot/poller.ts` — non-blocking; if no token configured, no-op.
- `server/src/api/index.ts`, `routes/students.ts`, `routes/exams.ts`, `routes/preferences.ts`, `routes/recommendations.ts`, `routes/colleges.ts` — REST mirrors of slash commands plus list endpoints for the operator UI.
- `server/src/api/routes/botConfig.ts` (NEW):
  - `GET /api/config/bot` — returns `{configured: boolean, target_chat_id, last_connected_at, last_error, bot_token_masked: "•••" + token.slice(-4)}`. Never returns full token.
  - `PUT /api/config/bot` — body `{bot_token?, target_chat_id?, webhook_secret?}`. Uses `hasOwnProperty` semantics (absent = leave; `null` = clear). UPSERTs `bot_config` (id='default'). After write, calls `restartBot()` from `bot/poller.ts` (stop old loop if any, start new if token now present).
  - `POST /api/config/bot/test` — calls Telegram `getMe` with the currently-stored token (NOT a token from the request body — operator must save first). Returns `{ok, bot_username?, error?}`. Updates `bot_config.last_error` on failure, `last_connected_at` on success.
- `server/src/bot/poller.ts` (NEW): exports `startBotIfConfigured()`, `restartBot()`, `stopBot()`. Holds a module-level `currentLoop: AbortController | null`. Loop: read bot_config row, if no token return; loop `fetch(https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${last_offset+1})`; on each update, route via `dispatch.ts`; persist `bot_config.last_processed_update_id` after the batch.
- `server/src/bot/dispatch.ts` (NEW): exports `handleUpdate(update, ctx)`. If `update.message.text` starts with `/`, parse `cmd` and `args` and call counseller hook's `handleSlashCommand`. Else build `getContext` system prompt and hand to `llm.ts`. Reply via `sendMessage` to `bot_config.target_chat_id` (NOT `update.message.chat.id` — operator scopes the bot to a single chat by design; messages from other chats are silently dropped + counter `bot.dropped_off_target_chat` incremented).
- `server/src/bot/llm.ts` (NEW): wraps `@google/generative-ai`, single-turn generation. System prompt = output of `getContext`. Parses output for `CALL: /add-exam {...}` markers, executes them via `handleSlashCommand`, strips the markers from the user-visible reply. Reads `GEMINI_API_KEY` from env; if absent, replies with a static "Counseller standalone-bot LLM is not configured (GEMINI_API_KEY missing). Use slash commands directly." message.

### web/* (standalone React dashboard)
- `web/package.json`, `web/vite.config.ts` (proxy `/api -> http://localhost:8788`), tailwind config, `src/main.tsx`, `App.tsx` (routes: `/students`, `/students/:chatId`, `/colleges`, `/colleges/:id`, `/config/bot`).
- Pages: `Students.tsx` (list all chat_ids with student rows, click to detail), `StudentDetail.tsx` (full bundle + recommendations preview), `Colleges.tsx` (list all colleges), `CollegeDetail.tsx` (branches + cutoffs).
- `pages/BotConfig.tsx` (NEW): form with three inputs — Bot Token (password input, placeholder shows masked existing value e.g. `••••1234` if configured), Target Chat ID (text), Webhook Secret (text, optional, for future webhook mode). Buttons: **Save** (PUT `/api/config/bot`), **Test Connection** (POST `/api/config/bot/test` — disabled until at least one save has happened). Status panel below the form: shows `last_connected_at`, `last_error`, current bot username from latest successful `getMe`. After Save, automatically triggers a Test and refreshes the panel. TanStack Query invalidates `["botConfig"]` after Save/Test.
- Layout sidebar gets a "Bot Config" link below "Colleges".
- Read-mostly UI for student/college pages; the primary write paths are the Telegram chat (plugin or standalone) and the Bot Config form. Operator-only edit capability is "delete attempt", "clear student", and "edit bot config".

### data/
- Per-app local files if any (none for V1). Git-ignored.

## Steps (numbered checklist)
- [ ] 0. **Tele-side prerequisite**: in `~/spaps/tele/apps/server/src/ai/applications.ts`, widen `CodeAppHookContext` with `databaseUrl?: string | null` and pass `databaseUrl: databaseUrl ?? null` in `loadCodeAppContext`'s ctx construction. Do the same widening in `~/spaps/tele/apps/server/src/ai/applicationSlash.ts:~81`. Sanity: `pnpm -F @tele/server build` exits 0; existing kundali-match continues to work (it ignores the new field).
- [ ] 1. `mkdir ~/spaps/counseller && cd ~/spaps/counseller && git init`. Write root `package.json`, `tsconfig.json`, `.gitignore`, empty `manifest.json` shell.
- [ ] 2. Author `manifest.json` with slug `counseller`, type `code`, and the five slash commands (`add-exam`, `set-preferences`, `recommend`, `list-exams`, `clear`).
- [ ] 3. Install deps: `npm install @neondatabase/serverless nanoid && npm install -D tsx typescript @types/node`.
- [ ] 4. Write `src/types.ts` with the ExamName enum, Category, ExamAttempt, Preferences, Recommendation, College/Branch/Cutoff types.
- [ ] 5. Write `src/db/client.ts` (neon cache) and `src/db/migrate.ts` (file-scanner, split-on-`;`, idempotent — lesson 2026-04-28).
- [ ] 6. Write `src/db/migrations/0001_init.sql` exactly as schemaed above. All `CREATE TABLE IF NOT EXISTS`, all FKs, all indices. CHECK on `exam_attempts`. `preferences.chat_id PRIMARY KEY`.
- [ ] 7. Write `src/db/migrations/0002_seed_colleges.sql`: ~30 colleges x ~3 branches with cutoff coverage per the exam-eligibility map above (~456 cutoff rows). All `ON CONFLICT DO NOTHING`. Header comment documents source + edit-via-new-migration rule.
- [ ] 7b. Write `src/db/migrations/0003_bot_config.sql`: `bot_config` single-row table per spec; seed the `'default'` row.
- [ ] 8. Write repos: `students.ts`, `examAttempts.ts`, `preferences.ts`, `colleges.ts`. Each takes the `sql` client as first arg so the hook can pass its per-url client.
- [ ] 9. Write `src/engine/recommender.ts` (pure functions: most-recent-year selection, per-unit-family dispatch, fit_reasons builder, sort) and `src/engine/prompts.ts` (PERSONA, METHODOLOGY, formatStudentProfile, nextStepInstruction).
- [ ] 10. Write `src/util/logger.ts` (copy of tele's logger.ts) and `src/util/errors.ts`.
- [ ] 11. Write `src/hook.ts`:
  - 11a. Top-of-file comment block mirroring kundali's (1)-(6) with counseller-specific details, including the new (7) "ctx.databaseUrl contract" section.
  - 11b. `getContext`: load profile, format, build instruction. Handle no-databaseUrl case gracefully.
  - 11c. `handleSlashCommand`: dispatch `add-exam`/`set-preferences`/`recommend`/`list-exams`/`clear`; each handler validates input, calls repos, catches `23505`, returns plain-text reply. Defensive `cmd` check at end returns `"Unknown command."`.
- [ ] 12. Write `server/src/index.ts` and route files. Order: `await ensureMigrated()` -> register `/api/*` routes (including `routes/botConfig.ts`) -> `@fastify/static` (prod only) -> `setNotFoundHandler`. Same lesson as tele (2026-05-04). After `app.ready()`, call `startBotIfConfigured()`.
- [ ] 12b. Write `server/src/bot/poller.ts` (long-poll loop + start/stop/restart), `server/src/bot/dispatch.ts` (route updates -> hook handlers), `server/src/bot/llm.ts` (Gemini reply path with `CALL: /...` marker parsing). All three modules import the hook via relative path (`../../src/hook.js`); no cross-package dep.
- [ ] 12c. Write `server/src/api/routes/botConfig.ts`: GET (masked), PUT (UPSERT + restartBot), POST `/test` (getMe + persist last_error/last_connected_at).
- [ ] 13. Smoke-test the hook standalone (no tele): `tsx -e "import('./src/hook.js').then(m => m.handleSlashCommand('add-exam','{\"exam_name\":\"JEE_MAIN\",\"year\":2024,\"percentile\":95,\"category\":\"GEN\"}', '123', { databaseUrl: process.env.DATABASE_URL }).then(console.log))"` -> returns success string; DB row inserted.
- [ ] 14. Install the plugin into tele: copy `~/spaps/counseller` to `~/spaps/tele/apps/server/applications/counseller/` via tele's installer flow (or symlink for dev), set `database_url` on the `applications` row in tele's admin UI to the same Neon URL.
- [ ] 15. End-to-end test in Telegram:
  - Send "I want help with college admissions" -> bot replies with proactive questions.
  - Send "I got 96 percentile in JEE Main 2024, GEN category" -> bot calls `/add-exam` and confirms.
  - Send "JEE Advanced rank 4500 too" -> another `/add-exam`.
  - Send "I want Computer Science in Maharashtra" -> bot calls `/set-preferences`.
  - Send "Show me recommendations" -> bot calls `/recommend` and returns trimmed list with IIT + NIT entries and reasons.
  - Send `/list-exams` directly -> bot returns the two attempts.
  - Send `/set-preferences {"max_fees_lakhs": null}` -> existing prefs retained, cap cleared (hasOwnProperty path).
- [ ] 16. Standalone web smoke test: `npm run dev`, open the dashboard, see the test chat's student bundle and the seeded colleges.
- [ ] 16b. **Standalone bot smoke test**: in the dashboard, open `/config/bot`. Save a real bot token from @BotFather + a target chat id. Click Test → see `last_connected_at` populate and bot username appear. Confirm server logs show the poller loop start. Send a message to the bot from the target chat → bot replies (slash and free-text both round-trip). Verify off-target-chat messages are dropped (counter increments).
- [ ] 17. Write `README.md`: install-into-tele, env vars (`DATABASE_URL`, `GEMINI_API_KEY`), `npm run dev` for standalone, **Standalone Bot Mode section** (how to get a token from @BotFather via `/newbot`, paste into `/config/bot` page, click Test, point students at `t.me/<bot_username>` or add the bot to a group and set its chat id as target_chat_id), schema overview, data caveat (seed is 2023+2024 public snapshot, ~30 colleges across 8 exams), recommender caveat (heuristic, not predictive), tele-side prerequisite (the `ctx.databaseUrl` widening), edit-seed-via-new-migration rule, mode-distinction note (don't run plugin AND standalone bot for the same chat).
- [ ] 18. Final pass: `npm run build` (hook + server + web) exits 0; `npm start` (production mode) serves SPA on 8788; `git status` shows expected files.

## Acceptance criteria
1. **Hook contract**: `~/spaps/counseller/src/hook.ts` exports `getContext(chatId, ctx?)` and `handleSlashCommand(cmd, args, chatId, ctx?)` matching tele's widened `CodeAppHookContext` (the `ctx.databaseUrl` field is consumed; absence is handled gracefully).
2. **Tele-side change applied**: `~/spaps/tele/apps/server/src/ai/applications.ts` and `applicationSlash.ts` now pass `databaseUrl` into the ctx object; existing kundali-match continues to load without errors.
3. **Idempotent migrations on Neon**: pointing a fresh Neon DB and re-running `ensureMigrated()` twice produces the same schema with seed data; the second run inserts zero new rows.
4. **Counselor flow in Telegram**: from a fresh chat, a natural-language conversation ("I have JEE Main 96-percentile 2024 GEN, want CSE in Maharashtra") results in the AI invoking `/add-exam` and `/set-preferences` slash commands (visible in the application metrics counters), and `/recommend` returns >= 3 college recommendations.
5. **8-exam coverage**: seeded cutoffs cover all 8 V1 exams (JEE_MAIN, JEE_ADVANCED, MHT_CET, BITSAT, VITEEE, KCET, AP_EAMCET, WBJEE) for 2023 and 2024, GEN and OBC categories. A query for `(exam_name=KCET, year=2024, category=GEN)` returns at least one cutoff row.
6. **23505 -> friendly message** (slash) and **23505 -> 409** (web): direct `INSERT` into `preferences` for the same chat_id twice raises 23505; the slash handler returns "Preferences already exist; use /set-preferences again to update specific fields"; the web POST returns 409 with the same body.
7. **List/get split**: `/recommend` slash output and `/api/chats/:chatId/recommendations` return trimmed projection (no full historical cutoff arrays). `/api/colleges/:id` returns the full college + branches + cutoffs payload.
8. **Standalone web works**: `cd web && npm run dev` (with proxy to server on 8788) shows the operator dashboard with seeded colleges and any test chat's student bundle. `npm run build && npm start` serves the production SPA.
9. **README documents**: (a) tele-side prerequisite, (b) data caveat — seed is 2023+2024 snapshot for ~30 colleges, (c) recommender is heuristic not predictive, (d) JEE-Advanced gating note (real eligibility requires JEE Main top ~2.5L; recommender does not enforce this), (e) edit-seed-via-new-migration rule, (f) Standalone Bot Mode setup steps (BotFather → save token in dashboard → Test → target chat).
10. **Standalone bot config persistence + masking**: PUT `/api/config/bot` with `{bot_token: "xxx", target_chat_id: "-100..."}` stores the row; GET `/api/config/bot` returns `bot_token_masked: "•••xxxx"` (last 4 chars only), NEVER the full token. Re-PUT with `{target_chat_id: "..."}` only (no bot_token) leaves the token intact. PUT with `{bot_token: null}` clears it and stops the bot loop.
11. **Standalone bot Test Connection**: POST `/api/config/bot/test` with a valid token returns `{ok: true, bot_username: "..."}` and updates `last_connected_at`; with an invalid token returns `{ok: false, error: "..."}` and updates `last_error`. Both states render in the dashboard's BotConfig page.
12. **Standalone bot end-to-end**: with a real token + target chat configured AND `GEMINI_API_KEY` env set, a message from the target chat round-trips through `getContext` -> Gemini -> `sendMessage`. A `/list-exams` from the same chat invokes `handleSlashCommand` directly without LLM call. A message from a non-target chat is dropped and `bot.dropped_off_target_chat` counter increments.
13. **Mode isolation**: when counseller is loaded as a tele plugin AND the standalone server is NOT running, the `bot_config` row is ignored and tele owns all delivery. The README explicitly warns against running both simultaneously for the same chat.

## Risks
- **Tele-side change is required**: Without the `applications.ts` + `applicationSlash.ts` widening, `ctx.databaseUrl` is `undefined` and counseller falls back to "not configured". Mitigation: Step 0 is the prerequisite; it must land before counseller can be acceptance-tested. The widening is small and backward-compatible (kundali-match ignores unknown fields).
- **`appDatabase.ts` hard-codes `kundali_matches` table**: counseller deliberately does NOT use `ctx.storeResult` because of this hard-coding. Mitigation: counseller calls Neon directly via `ctx.databaseUrl`. If a future plugin needs a generic typed `storeResult`, that's a separate tele refactor — out of scope.
- **Cutoff data accuracy/scope**: ~456 rows across 30 colleges and 8 exams is still a tiny slice of real Indian admissions (thousands of colleges, multiple rounds per exam, dozens of category permutations). Mitigation: README is explicit; schema supports new-migration seed updates.
- **Per-unit-family dispatch is load-bearing**: a percentile vs rank comparison bug returns nonsense recommendations. Mitigated by the unit-family table above and a unit test in step 9 (mental walk-through; future work could codify).
- **AI proactive-questioning quality depends on prompt engineering**: The `getContext` text instructs the AI to ask specific follow-ups, but Gemini may go off-script (ask for fields we don't need, skip required ones). Mitigation: explicit `[NEXT-STEP]` section names the exact next question the AI should ask; verifier should observe a few turns to confirm.
- **`/add-exam` and `/set-preferences` invoked by the AI, not the user**: the AI is instructed to use slash commands as a tool — but if the user types the slash command directly, it must also work. Both paths share the same handler; documented in README.
- **Multi-user / multi-tele safety**: counseller's DB is keyed on `chat_id`. Multiple tele installations pointing at the same Neon DB would see each other's chats. Mitigation: README recommends one Neon DB per tele install (the per-app database_url is set per-tele); if shared deployments are needed, future work adds a `tele_instance_id` namespace.
- **Plugin install path coupling**: tele dynamic-imports `hook.ts` via `pathToFileURL`; the install pattern copies the source. If counseller adds new files under `src/`, they must be included in the copy. Documented in kundali-match's hook (1)-(2) comments; we mirror them.
- **Schema-migration ordering**: `0002_seed_colleges.sql` references columns added in `0001_init.sql`. Filename sort order ensures correct application. Documented in the migrate runner.
- **Plaintext bot token in DB**: `bot_config.bot_token` is stored unencrypted. Acceptable for V1 single-operator deployments; not acceptable for multi-tenant. Mitigation: README warns; future work moves token to secrets manager (Doppler/env-only). API never returns the full token (masked GET response).
- **Dual-mode delivery (plugin + standalone) collision**: if operator runs both for the same target chat, students get double replies and double DB writes. No technical prevention in V1 — both modes execute the same handlers idempotently for `/add-exam` (no unique constraint allows duplicates by design — retakes) but `/set-preferences` would still race. Mitigation: README warning + dashboard banner attempt.
- **Standalone bot polling-loop liveness**: a crashed loop is invisible without an external watchdog. Mitigation: `bot_config.last_connected_at` is bumped per successful `getUpdates` batch; dashboard surfaces staleness ("> 2min" = warn, "> 10min" = error). `last_error` surfaces auth failures and rate limits.
- **`CALL: /...` marker LLM contract is fragile**: V1 standalone bot avoids Gemini tool-use by string-matching markers. If the model returns malformed markers, the slash is silently dropped (parsed but invalid JSON returns an error string that's hidden from user). Mitigation: explicit grammar in the system prompt + log every parse failure + future work migrates standalone bot to Gemini function-calling like tele does.
- **GitHub publication**: out of scope for V1; local `git init` only.
