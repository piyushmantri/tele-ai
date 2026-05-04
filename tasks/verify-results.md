# Verification — Telegram Bot API integration

Verifier: read-only static + typecheck pass on 2026-05-04. No source files modified.

## Acceptance criteria

### 1. PASS ✓ — Migration `0012_telegram_bots.sql` correct columns, idempotent DDL
Evidence: `apps/server/src/db/migrations/0012_telegram_bots.sql` uses `CREATE TABLE IF NOT EXISTS telegram_bots (...)` with all required columns: `id UUID PK DEFAULT gen_random_uuid()`, `name TEXT NOT NULL`, `token TEXT NOT NULL UNIQUE`, `description TEXT NOT NULL DEFAULT ''`, `system_prompt TEXT NOT NULL DEFAULT ''`, `enabled BOOLEAN NOT NULL DEFAULT TRUE`, `webhook_secret TEXT NOT NULL`, `created_at TIMESTAMPTZ DEFAULT now()`. Plus `CREATE INDEX IF NOT EXISTS idx_telegram_bots_enabled`. No `DROP` / `DELETE` statements (`grep -in "DROP\|DELETE"` returns zero hits) — old `bots` / `bot_chats` tables preserved.

### 2. PASS ✓ — API routes mounted at `/api/bots` (not `/api/telegram-bots`)
Evidence: `apps/server/src/api/routes/telegramBots.ts:75-182` registers `app.get("/api/bots")`, `app.post("/api/bots")`, `app.put("/api/bots/:id")`, `app.patch("/api/bots/:id/enabled")`, `app.delete("/api/bots/:id")`.

### 3. PASS ✓ — Webhook `/webhook/:botId` registered BEFORE staticPlugin/setNotFoundHandler
Evidence: `apps/server/src/api/index.ts:61-62` calls `await registerTelegramBotRoutes(app)` and `await registerTelegramWebhookRoutes(app)` BEFORE the `app.register(staticPlugin, ...)` block at lines 67-72 and the `app.setNotFoundHandler` at line 73. The auth hook at lines 37-45 only intercepts URLs starting with `/api`, so `/webhook/:botId` correctly bypasses auth. Webhook registration is at `apps/server/src/api/routes/telegramWebhook.ts:30`.

### 4. PASS ✓ — `timingSafeEqual` used for secret comparison
Evidence: `apps/server/src/api/routes/telegramWebhook.ts:9` imports `timingSafeEqual` from `node:crypto`; `apps/server/src/api/routes/telegramWebhook.ts:18-27` defines `safeEqualHeader` that converts both header value and expected secret to Buffers, returns false on length mismatch (avoiding the throw), and otherwise calls `timingSafeEqual(a, b)`. Used at line 52 against `bot.webhook_secret`. Returns 401 on mismatch (line 53).

### 5. PASS ✓ — `callback_query` ACK fires without await before AI loop
Evidence: `apps/server/src/ai/botResponder.ts:67-78` — inside `handleBotUpdate`, when `update.callback_query` is present, the dynamic import + `m.answerCallbackQuery(token, { callback_query_id: id })` chain is prefixed with `void` and has a `.catch(err => logger.warn(...))` tail; no `await` precedes it. The synchronous code then proceeds to `extractTurn`, model setup, and `runToolLoop` (line 120). The ack and the AI loop run concurrently.

### 6. PASS ✓ — `handleBotUpdate` catches all errors
Evidence: `apps/server/src/ai/botResponder.ts:62-135` — the entire body of `handleBotUpdate` is wrapped in `try { ... } catch (err) { logger.error(...) }`. The catch comment at line 129 explicitly notes "handleBotUpdate must NEVER throw — webhook handler depends on this." No re-throw in the catch block.

### 7. PASS ✓ — `23505` → 409 on POST AND PUT
Evidence: `apps/server/src/api/routes/telegramBots.ts:29-39` defines `isUniqueViolation(err)` that returns `{ yes: true, field }` when `err.code === "23505"`, picking up `token` or `name` from the detail/constraint string. Used in:
- POST handler `apps/server/src/api/routes/telegramBots.ts:89-98` — catches the create error, returns `reply.code(409)` with `{ error: "<field> already exists" }`.
- PUT handler `apps/server/src/api/routes/telegramBots.ts:130-139` — same pattern around `updateTelegramBot(id, patch)`.

### 8. PASS ✓ — `PUBLIC_URL` unset → warning log, no throw
Evidence: `apps/server/src/api/routes/telegramBots.ts:41-60` — `tryRegisterWebhook` opens with `if (!config.PUBLIC_URL) { logger.warn("PUBLIC_URL unset — skipping setWebhook", { bot_id }); return; }` — warns and early-returns. The `setWebhook` call itself is wrapped in `try/catch` that downgrades any failure to `logger.warn(...)`. Config schema at `apps/server/src/config.ts:21` declares `PUBLIC_URL: z.string().url().optional()` — optional, so unset is valid.

### 9. PASS ✓ — Old persona bots fully removed
Evidence:
- `ls apps/server/src/db/repos/bots.ts apps/server/src/api/routes/bots.ts` → both "No such file or directory".
- `grep -rn "getBotForChat\|registerBotRoutes" apps packages` → zero hits.
- `grep -rnE "CreateBotBody\b|UpdateBotBody\b" apps packages` → zero hits.
- `apps/server/src/telegram/router.ts:121` ends with plain `await generateAndReply(updatedChat, text, msg.id);` — no `getBotForChat` import (lines 1-12 imports inspected), no `opts` argument, no `systemInstructionOverride` lookup.
- `packages/shared/src/types.ts` — `Bot`, `CreateBotBody`, `UpdateBotBody` interfaces are absent (only the new `TelegramBot` / `CreateTelegramBotBody` / `UpdateTelegramBotBody` at lines 208-232).

### 10. PASS ✓ — Sidebar and App.tsx correctly reference `/bots` and "Bots"
Evidence:
- `apps/web/src/components/Sidebar.tsx:5` — `{ to: "/bots", label: "Bots" }` present in the items array.
- `apps/web/src/App.tsx:17` — `import Bots from "./pages/Bots";`
- `apps/web/src/App.tsx:59` — `<Route path="/bots" element={<Bots />} />`.
- `apps/web/src/pages/Bots.tsx` exists and renders the new TelegramBot CRUD UI (queryKey `qk.bots`, calls `/api/bots`).

### 11. PASS ✓ — `pnpm -F @tele/shared build`
Evidence: `cd /Users/piyush.mantri/spaps/tele && pnpm -F @tele/shared build` — output: `> tsc -p tsconfig.json` with no errors, exit 0.

### 12. PASS ✓ — `cd apps/server && npx tsc --noEmit`
Evidence: zero output, `EXIT_CODE=0`.

### 13. PASS ✓ — `cd apps/web && npx tsc --noEmit`
Evidence: zero output, `EXIT_CODE=0`.

### 14. PASS ✓ — `botApi.ts` never logs the token
Evidence: `apps/server/src/telegram/botApi.ts` contains exactly one logger call — line 36: `logger.warn("bot api error", { method, status: res.status, description: desc });` — payload includes `method`, `status`, `description` only. No `token` field. The token is interpolated into the URL string at line 18 (`https://api.telegram.org/bot${token}/${method}`) but the URL is never logged. File header comment at lines 3-4 explicitly forbids logging the token.

## Summary

All 14 acceptance criteria pass. Implementation matches plan and lessons; static checks and typechecks are clean. Old persona-bot feature is fully excised, new Telegram Bot API surface is wired correctly, and the public webhook is registered before catch-all handlers and bypasses auth as designed.
