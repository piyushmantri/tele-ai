# Verify results — Tele developer docs + in-app Docs page

Verifier run on 2026-06-04. No source files modified during verification.

## Overall verdict: PASS

All 4 acceptance criteria pass. Every in-repo citation in the doc was cross-checked
line-by-line against the cited source files; all match.

---

## AC1 — doc exists, all 8 sections, claims match real APIs, no in-repo file attributed to counseller — PASS

`docs/building-applications.md` exists (13173 bytes). All 8 sections present:
1. Overview, 2. Hello World ai_only, 3. Hello World code app, 4. The hook contract,
5. Database integration, 6. Logging & metrics, 7. Slash commands, 8. Debugging
(plus an Appendix labeling counseller as out-of-repo).

Cross-checks against real source (every citation verified):

- `apps/server/applications/uptime-monitor/hook.ts:6-9` — doc's hello-world snippet
  reproduces the exact 1-arg `getContext(_chatId)` body.
- `ai/applications.ts:121-132` — ai_only system prompt + KB concat, empty skipped.
- `ai/applications.ts:110` `buildApplicationsContext` (calls `loadCodeAppContext`).
- `ai/applications.ts:35-40` in-tele ctx `{emit, emitTimeseries, storeResult, databaseUrl}`.
- `ai/applications.ts:43-47` ctx optional / 1-arg valid (signature widening).
- `ai/applications.ts:63-67` databaseUrl injected fresh each turn.
- `ai/applications.ts:79` warn "application hook load failed".
- `ai/applications.ts:140` warn "code app missing installed_path".
- `ai/applicationSlash.ts:17-22` in-tele ctx shape.
- `ai/applicationSlash.ts:28-34` `handleSlashCommand(cmd, args, chatId, ctx?)`.
- `ai/applicationSlash.ts:111-116` multiple apps same command -> first wins + warn.
- `ai/applicationBotRunner.ts:41` standalone ctx `{databaseUrl, geminiApiKey, geminiModel}`.
- `ai/applicationBotRunner.ts:107` warn "hook import failed".
- `ai/applicationBotRunner.ts:150-168` CALL: /cmd {json} extraction loop (matches quoted snippet).
- `ai/applicationBotRunner.ts:209-210` `ensureDb(databaseUrl)` at startup, before bot_config read (SELECT at 215-219).
- `ai/applicationBotRunner.ts:269-270` "bot_config does not exist" benign skip.
- `applications/install.ts:156-160` manifest slug must equal registry slug or reject.
- `applications/install.ts:161-164` code type requires src/hook.ts.
- `applications/install.ts:84-101` local path must be absolute, no `~`.
- `applications/install.ts:16` INSTALLED_APPS_BASE = data/applications; `resolveInstalledPath` exists at install.ts:81.
- `applications/registry.ts:6` slugRegex `^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$`.
- `applications/registry.ts:8-11` slashCommandManifestSchema (name `^[a-z0-9_-]+$`, desc 1-200).
- `applications/registry.ts:13-22` manifestSchema fields.
- `ai/applicationMetrics.ts:36` custom name regex `^[a-z0-9_]{1,64}$`.
- `ai/applicationMetrics.ts:37` ring 240 samples.
- `ai/applicationMetrics.ts:1-2` PLUGIN BOUNDARY (don't import directly).
- `util/logger.ts:6` LOG_FILE = /tmp/spaps-server.log, JSONL to console + file.

Counseller appears ONLY in the Appendix (lines 352-356), explicitly labeled as living
outside this repo (`~/spaps/counseller`) and "illustrative only." No in-repo file is
attributed to counseller. The final section 5 (Database integration) is self-contained
and does NOT reference counseller.

## AC2 — visible Docs link on both tabs, navigates to /applications/docs, renders guide with back link — PASS

- `apps/web/src/pages/Applications.tsx:183-187` — `<Link to="/applications/docs">` wrapping
  a ghost `Button` labeled "Docs", inside the right-side header `<div className="flex items-center gap-2">`
  (line 182), which is OUTSIDE the `tab === "installed"` conditional (line 188 wraps only
  the "+ Add application" button). Page body tab branch is at line 206. Link renders on
  both Installed and Browse tabs. `Link` imported at line 2.
- `apps/web/src/pages/Docs.tsx` — exists; `import md from "../../../../docs/building-applications.md?raw"`
  (line 2); renders `{md}` in a scrollable `<pre>` inside `h-full overflow-y-auto p-6`;
  "Back to Applications" `<Link to="/applications">` (lines 7-13).
- `apps/web/src/App.tsx` — imports `Docs` (line 21); route `<Route path="/applications/docs" element={<Docs />} />`
  at line 63, placed before `/applications/:id` (line 64).

## AC3 — tsc -b exits 0, vite build succeeds, no new web deps — PASS

- `cd apps/web && npx tsc -b` -> exit 0.
- `npx vite build` -> exit 0; "built in 924ms". The `?raw` import resolved across the
  apps/web -> repo-root docs/ boundary — confirmed by grepping the bundled JS
  (`dist/assets/index-*.js`) for "Building tele Applications" (found). No vite alias was
  needed; the relative climb works.
- `git diff HEAD~4..HEAD -- apps/web/package.json` -> empty. No new runtime dependency
  (and no markdown library: react-markdown/marked/remark/markdown-it/rehype all absent).

## AC4 — no server source files modified; only the 4 intended files changed — PASS

`git diff --name-only HEAD~4..HEAD` (the 4 docs commits 9506557..f3f7d2f):
- docs/building-applications.md (new)
- apps/web/src/pages/Docs.tsx (new)
- apps/web/src/App.tsx
- apps/web/src/pages/Applications.tsx

No `apps/server/**` files touched. (Note: a wider `HEAD~6..HEAD` range shows
applicationBotRunner.ts, but that belongs to the unrelated pre-existing commit b123fe4,
not the docs work.) Build did not dirty any tracked source files (dist/ is gitignored).

---

## Concerns (non-blocking)

1. **Plain `<pre>` rendering** — the markdown renders as raw text (headings show as `##`,
   tables as pipes, code fences as backticks). This is an intentional v1 scope decision
   per the plan (no markdown lib, zero new deps). Readable but not pretty. A markdown
   renderer is deferred.
2. **Doc drift risk** — the doc hardcodes line-number citations (e.g. `applications.ts:121-132`).
   These are correct today but will rot as the cited files change. The doc mitigates by
   also naming the symbols (function/const names), which are more stable than line numbers.
3. **Browser-level AC2 not exercised** — link placement, route, and back link were verified
   by source inspection and a passing build, not by clicking in a running browser. The
   logic is unambiguous (link is outside the tab conditional; route is registered before
   the `:id` param route), so confidence is high, but a live click-through was not performed.
