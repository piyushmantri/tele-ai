# Global Telegram Bot with AI Inline Keyboards

## Task
Introduce a single, global Telegram **Bot API** bot configured from the dashboard (token + system prompt + enabled toggle, stored as one row). Expose a public webhook endpoint for the bot. The AI loop replies to bot users with text and can attach inline keyboards / menu options. When a user presses an inline keyboard button (`callback_query`), the option's data is converted into a synthetic chat message so the AI continues the conversation normally. The dashboard "Bots" page renders only the global bot's configuration; bot conversations are persisted in the existing `chats` / `messages` tables so the dashboard's Sessions view shows bot traffic alongside user-account DMs.

## Lessons applied
- **2026-04-28 — Neon `;`-split, idempotent DDL**: new migration uses only `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. No multi-statement blob; no `DROP TABLE` of the old `bots` table from migration 0011.
- **2026-04-28 — Build `@tele/shared` before server typecheck**: any change to `packages/shared/src/types.ts` (new `TelegramBot` types, new `chat_type = 'bot'`, new `WsEvent` variants) requires `pnpm -F @tele/shared build` before downstream typecheck.
- **2026-04-30 — `enabled` re-checked at every consumer**: webhook handler must re-load the bot row and short-circuit silently when `enabled = false`, not just rely on dashboard-side filtering.
- **2026-04-30 — `hasOwnProperty` for PATCH semantics**: `updateGlobalBot(patch)` uses `Object.prototype.hasOwnProperty.call(patch, k)` so callers can clear nullable fields (e.g. set `description = ''`) cleanly; reject empty patches.
- **2026-04-30 — Catch `23505` → 409**: token is UNIQUE; both POST (set) and PUT (update) trap unique-violation.
- **2026-04-30 — `pnpm -F <pkg> typecheck` silent on missing script**: confirm the script exists in each package; otherwise call `npx tsc --noEmit` directly with explicit exit-code check.
- **2026-04-30 — Persist synthetic outbound message for AI-side artifacts**: callback_query button presses are persisted as `[Button: <data>]` synthetic incoming messages (mirrors the `[Poll: ...]`, `[Image: ...]` patterns in sender.ts) so the AI loop sees them as real user turns and the dashboard renders them.
- **2026-05-02 — Optional `opts` with `??` fallback**: `generateAndReply`'s signature stays unchanged. We add an optional `opts.replyAdapter` (and optional `opts.systemInstructionOverride`) for the bot path so the same AI loop can dispatch to either GramJS `sendReply` or a Bot-API `sendMessage`. Default behavior unchanged for existing GramJS callers.
- **2026-05-02 — `as any` scoped + commented**: any cast required to feed `reply_markup` through Gemini's tool-call schema goes on the smallest object literal, with a one-line comment naming the SDK and Bot API method.
- **2026-05-04 — Public webhook routing via auth-hook scope**: webhook mounts at `/webhook/telegram-bot` (outside `/api/*`), so the existing `onRequest` auth hook in `api/index.ts:35-43` naturally lets it through. Do NOT widen `PUBLIC_PATHS`; the path-prefix is the boundary. Add a top-of-file comment in the webhook route file calling out this dependency on the hook's scope.
- **2026-05-04 — `timingSafeEqual` length-mismatch handling**: webhook secret-token check goes through a `safeEqualHeader(actual, expected)` helper that returns `false` on length mismatch BEFORE calling `timingSafeEqual` — never try/catch the throw.
- **2026-05-04 — Webhooks: always 200, except 401 for the one back-off signal**: webhook returns 200 for unknown global-bot row, disabled bot, parse failures, internal exceptions; only the secret-token mismatch returns 401 (Telegram's documented "stop retrying" signal).
- **2026-05-04 — Fire-and-forget ACK before async work**: `void answerCallbackQuery(callback_query.id).catch(log)` fires immediately on a callback_query update — never `await` it before kicking off the AI loop. The `void` prefix and `.catch` are both load-bearing.
- **2026-05-04 — Webhook + CRUD route registration ordering**: register the webhook route AND the new bot-config route BEFORE `setNotFoundHandler` and the static plugin's catch-all in `api/index.ts`.
- **2026-05-04 — `BIGINT` chat ids: persist as text, prefer string form for Bot API**: bot chat ids are persisted in the existing `chats.tg_chat_id BIGINT` column; convert to string when feeding the Bot API `chat_id` JSON field (Bot API accepts both, string is forward-compatible).
- **2026-05-04 — Webhook secret rotation = delete + recreate**: there is no "rotate secret" endpoint; rotating means clearing the bot config and re-saving. Documented in dashboard help text.
- **2026-04-30 — `WsEvent` discriminated union audit**: the new `chat_type = "bot"` does not add a new `WsEvent` variant — bot messages reuse the existing `message:new` / `message:sent` events. Verify no `useWsEvent` consumer has a `default:` branch that would silently drop bot-typed chats. (None expected; ChatList just renders any chat with `chat_type` displayed.)

## Architectural decisions (the why behind the structure)

1. **Global = single row, not multi-row CRUD.** The user's spec says "introduce a global Telegram bot." We persist one row in a new `telegram_bot_config` table (UUID PK with a singleton CHECK constraint, or a simple settings-style key in the existing `settings` table). Picking a dedicated table over the JSON `settings` blob because: (a) `webhook_secret` should never be exposed in `GET /api/settings`, (b) `enabled` toggle reactivity is cleaner with a dedicated route, (c) future expansion (per-bot tools, per-bot persona) does not require a schema migration. **Singleton enforced** via `CREATE UNIQUE INDEX ... ON telegram_bot_config((TRUE))` so a second insert errors with `23505` — the API translates it to "config already exists; use PUT". Backward-compatible: the previous `bots` / `bot_chats` tables from migration 0011 are LEFT IN PLACE (no destructive drop) per lessons-2026-04-30.

2. **AI loop is shared, not forked.** The existing `generateAndReply(chat, text, ...)` already does: load history, build tools, call Gemini, run tool loop, send reply. We extend it with two optional opts: `systemInstructionOverride` (already supported) and `replyAdapter?: { sendText(text, replyMarkup?) → Promise<void>; persistOutbound(text) → Promise<Message> }`. Default `replyAdapter` is GramJS (current behavior). Bot path injects a Bot-API adapter. **No new responder file**; the bot-update handler builds a synthetic `Chat` row (or upserts the bot user as a real `chats` row with `chat_type='bot'`), calls `generateAndReply` with the bot's adapter and the bot's system prompt override.

3. **Bot users get real `chats` rows.** When a Bot API message arrives, we upsert the sender into the existing `chats` table with a new `chat_type` value `'bot'` (extends the existing CHECK constraint via migration). The chat's `tg_chat_id` is the Bot API `chat.id`. This means bot conversations appear in the dashboard Sessions view, share `messages` history with the AI loop's `getRecentForAi`, and inherit reminder targeting / kanban assignee semantics for free.
   - **Why this differs from the previous "v1 ephemeral" plan**: the spec says "the response on the selected option to a menu should be sent as a chat message for AI to continue normally." Persisting bot chats in `messages` is the natural way to give the AI multi-turn context. The cost (one new chat_type, one CHECK extension) is small.
   - Disambiguation: bot chats and GramJS chats can share a `tg_chat_id` integer space (Telegram user ids are global), so the UNIQUE constraint on `chats.tg_chat_id` becomes a problem ONLY if the same user DMs both the GramJS account AND the bot. To avoid that collision, the upsert key is `(tg_chat_id, chat_type)`. Migration replaces the `UNIQUE(tg_chat_id)` with `UNIQUE(tg_chat_id, chat_type)`. Idempotent; documented in migration comment.

4. **Inline keyboards as a tool.** New AI tool `send_message_with_buttons({ text, buttons: [[{ text, callback_data }]] })` constructs `reply_markup.inline_keyboard` and posts via the Bot API. Tool registry includes this tool ONLY when the chat is a bot chat (gated in `buildTools(chat_id, tg_chat_id, isBot)`). For non-bot chats the tool is omitted from Gemini's surface entirely so the AI cannot accidentally try to send buttons through the GramJS path (which doesn't support them in DMs).
   - We also add `set_bot_commands({ commands: [{ command, description }] })` and `set_chat_menu_button({ menu_button })` — but these are GLOBAL bot config tools (not per-chat), so they are exposed regardless of chat type but no-op if the bot is not configured.

5. **Callback queries → synthetic incoming message.** When `callback_query` arrives:
   1. Fire-and-forget `answerCallbackQuery(callback_query.id)` (clears the spinner).
   2. Upsert the sender as a bot-chat (same as above).
   3. Insert a synthetic message: `direction='in', source='user', text='[Button: <callback_data>]'` (with `tg_message_id = String(callback_query.message.message_id)` so the dashboard can correlate). Mirrors the `[Poll: ...]` pattern in sender.ts.
   4. Call `generateAndReply(chat, '[Button: <data>]', message_id, { replyAdapter: botAdapter, systemInstructionOverride: bot.system_prompt })`. The AI sees the button press as a user turn and replies normally.
   - This satisfies "the response on the selected option to a menu should be sent as a chat message for AI to continue normally" — exactly.

6. **Webhook route is PUBLIC** at `/webhook/telegram-bot` (singleton, no `:botId` param). The auth hook at `api/index.ts:35-43` only intercepts `/api/*` URLs, so the webhook bypasses auth automatically. The webhook secret-token check is the auth boundary instead.

7. **Reply keyboards are NOT supported in v1.** Spec calls out "menu options and inline keyboard options" — both map to inline keyboards (callback_data) or to the bot's `setMyCommands` registry. Reply keyboards (text-reply buttons) are an alternate UX that confuses the same AI loop (no `callback_query`, just a text message that looks like a normal user message). Document as a deliberate v1 omission. If the user later wants reply keyboards, the `text` of the pressed button arrives as a regular `message.text` → no extra code needed beyond exposing a `reply_keyboard` parameter on `send_message_with_buttons`.

8. **`PUBLIC_URL` env var.** Add `PUBLIC_URL: z.string().url().optional()` to config schema. On bot-config save (and on enabled-toggle to true), if `PUBLIC_URL` is set we POST to `/setWebhook` with `url=${PUBLIC_URL}/webhook/telegram-bot, secret_token=<row.webhook_secret>`. If `PUBLIC_URL` is unset, the save still succeeds with a logged warning so local dev (no tunnel) does not fail. Disabled-toggle and DELETE call `/deleteWebhook`.

9. **Bot API client = plain `fetch`.** No SDK. A `botApi(token, method, body)` helper in `apps/server/src/telegram/botApi.ts` POSTs JSON to `https://api.telegram.org/bot${token}/${method}` and parses Telegram's `{ ok, result, description }` envelope. Errors throw with the `description` so tool handlers return `{ ok: false, error }`. Token is NEVER logged at any level.

10. **Dashboard "Bots" page is a single-form (not a CRUD list).** Form fields: `token` (password input), `system_prompt` (textarea), `enabled` (toggle), and read-only `webhook_url` derived from `PUBLIC_URL + /webhook/telegram-bot`. Save calls `PUT /api/telegram-bot` (idempotent upsert). Delete clears the row + calls `deleteWebhook`. Form mirrors styling of `Settings.tsx`. New sidebar entry `{ to: "/bots", label: "Bots" }` and frontend route `/bots`.

## Files to touch

### New files
| Path | Reason |
| --- | --- |
| `apps/server/src/db/migrations/0012_telegram_bot_config.sql` | Create singleton `telegram_bot_config` (id UUID PK, token TEXT UNIQUE, system_prompt TEXT, enabled BOOLEAN, webhook_secret TEXT, created_at TIMESTAMPTZ); UNIQUE INDEX on `((TRUE))` to enforce singleton. Drop existing `chats_tg_chat_id_key` UNIQUE constraint and replace with `UNIQUE(tg_chat_id, chat_type)`. Extend `chats.chat_type` CHECK constraint to allow `'bot'` (or rebuild as a TEXT check including all four values). All idempotent; comment header references this plan. |
| `apps/server/src/db/repos/telegramBotConfig.ts` | `getTelegramBotConfig()` (returns the singleton row or null), `setTelegramBotConfig(patch)` (upsert; auto-generates `webhook_secret = randomBytes(32).toString("hex")` on first insert; uses `hasOwnProperty` for PATCH semantics; rejects empty patch), `clearTelegramBotConfig()` (deletes row), `setEnabled(enabled)` (toggles flag, returns updated row). |
| `apps/server/src/telegram/botApi.ts` | `botApi<T>(token, method, body)` fetch helper. Typed wrappers: `setWebhook`, `deleteWebhook`, `sendMessage`, `answerCallbackQuery`, `editMessageReplyMarkup`, `setMyCommands`, `setChatMenuButton`. Token never logged. Throws `Error(description)` on `{ ok: false }`. |
| `apps/server/src/telegram/botSender.ts` | Bot-API `replyAdapter` factory: `makeBotReplyAdapter(token, tgChatId, dbChatId)` returns `{ sendText(text, replyMarkup?), persistOutbound(text) }`. `sendText` POSTs to `/sendMessage` with `chat_id`, `text`, optional `reply_markup`; `persistOutbound` calls `insertMessage(direction='out', source='ai')` and emits `message:sent`. |
| `apps/server/src/ai/tools/botMessages.ts` | `makeBotMessageTools(token, tgChatId)`: returns 4 tool defs — `send_message_with_buttons({ text, buttons })`, `set_bot_commands({ commands })`, `set_chat_menu_button({ menu_button })`, `edit_message_buttons({ message_id, buttons })`. Each tool calls `botApi` and returns `{ ok, result }`. Bot-only; non-bot chats don't get these tools. |
| `apps/server/src/ai/botUpdateHandler.ts` | `handleBotUpdate(update)` — entry point for webhook. Loads `telegram_bot_config` (early-out if missing/disabled). Branches on update kind: `message` → upsert chat (`chat_type='bot'`), insertMessage (in, user), generateAndReply with bot adapter + system prompt; `callback_query` → fire ACK, upsert chat, insertMessage (in, user, `[Button: <data>]`), generateAndReply; `poll_answer` → upsert chat, insertMessage (in, user, `[Poll vote: ...]`), generateAndReply. All errors caught + logged; never re-thrown. |
| `apps/server/src/api/routes/telegramBot.ts` | CRUD routes (singleton): `GET /api/telegram-bot` returns `{ config: TelegramBotConfig | null }`; `PUT /api/telegram-bot` validates body with zod, upserts via `setTelegramBotConfig`, catches `23505` → 409, calls `setWebhook` if enabled+`PUBLIC_URL` set; `DELETE /api/telegram-bot` calls `deleteWebhook` then `clearTelegramBotConfig`; `PATCH /api/telegram-bot/enabled` toggles enabled + (re)registers/deregisters webhook accordingly. Token field is INCLUDED in GET response (dashboard needs it for edit-form) — gated by existing dashboard auth. |
| `apps/server/src/api/routes/telegramBotWebhook.ts` | PUBLIC route `POST /webhook/telegram-bot`. Top-of-file comment notes dependency on auth-hook scope. Reads `X-Telegram-Bot-Api-Secret-Token` header, length-mismatch-safe compare via `safeEqualHeader`, mismatch → 401. On match: parse body as `TelegramUpdate`, fire-and-forget `handleBotUpdate(update).catch(err => logger.error(...))`, return 200 immediately. ALL other failure modes (no config row, disabled config, parse errors) → 200 silent. |
| `apps/server/src/util/safeEqual.ts` | `safeEqualHeader(actual: string \| string[] \| undefined, expected: string): boolean` helper. Returns `false` on length mismatch BEFORE `timingSafeEqual`. Reusable shared util. |
| `apps/web/src/pages/Bots.tsx` | NEW dashboard page. Single form (not a list): token (password input), system_prompt (textarea), enabled toggle, read-only webhook_url preview. Save = `PUT /api/telegram-bot`; Delete (with confirm) = `DELETE`. Help text: "to rotate the secret, delete and re-save the config." Help text: "PUBLIC_URL must be set for Telegram to deliver updates." |

### Modified files
| Path | Reason |
| --- | --- |
| `apps/server/src/config.ts` | Add `PUBLIC_URL: z.string().url().optional()` to schema. |
| `apps/server/src/api/index.ts` | (1) Import `registerTelegramBotRoutes` from `./routes/telegramBot.js` and `registerTelegramBotWebhookRoute` from `./routes/telegramBotWebhook.js`. (2) `await` both registrations BEFORE `setNotFoundHandler` and the `staticPlugin` registration. The webhook route's `/webhook/telegram-bot` path naturally bypasses the `/api/*`-only auth hook — no change to `PUBLIC_PATHS` needed. Add a one-line comment near the registration noting why path order matters. |
| `packages/shared/src/types.ts` | (1) Add `TelegramBotConfig` interface (id, token, system_prompt, enabled, webhook_secret, created_at). (2) Add `UpdateTelegramBotConfigBody` (token?, system_prompt?, enabled?). (3) Extend `Chat.chat_type` union from `"private" \| "group" \| "channel"` to `"private" \| "group" \| "channel" \| "bot"`. Audit all consumers (server router.ts, ChatList, ChatView) for switch statements with `default:` branches that would silently drop the new variant — none expected, but verify. |
| `apps/server/src/db/repos/chats.ts` | `upsertChat` body is unchanged in shape, but the implicit ON CONFLICT target changes to `(tg_chat_id, chat_type)` matching the new composite UNIQUE. Read current file; if the SQL hard-codes `ON CONFLICT (tg_chat_id)`, update to `ON CONFLICT (tg_chat_id, chat_type)`. |
| `apps/server/src/ai/responder.ts` | (1) Add `replyAdapter?: ReplyAdapter` to `opts`. (2) After `runToolLoop` returns text, branch: if `opts?.replyAdapter` provided, call `opts.replyAdapter.sendText(finalText)` and `opts.replyAdapter.persistOutbound(finalText)` instead of `sendReply(chat, finalText, "ai")`. Default behavior unchanged. (3) Where the existing code calls `sendReaction` after a successful reply, gate that on the absence of `replyAdapter` (the bot path does not have a thinking/done reaction equivalent in v1). |
| `apps/server/src/ai/tools/index.ts` | Extend `buildTools(chat_id, tg_chat_id)` signature to `buildTools(chat_id, tg_chat_id, opts?: { isBot?: boolean; botToken?: string })`. When `opts?.isBot && opts?.botToken`, append the bot-API tools from `makeBotMessageTools(opts.botToken, tg_chat_id)` to the registry. Otherwise omit them. |
| `apps/web/src/App.tsx` | Add `import Bots from "./pages/Bots";` and `<Route path="/bots" element={<Bots />} />`. |
| `apps/web/src/components/Sidebar.tsx` | Add `{ to: "/bots", label: "Bots" }` to the `items` array (anywhere in the list; place before "Settings" for parity with feature ordering). |
| `apps/web/src/lib/queryKeys.ts` | Add `telegramBot: ["telegramBot"] as const` entry. |

> **Atomicity note**: `App.tsx` adds an import for `./pages/Bots` and Phase 7 writes that file. Within the same change set, write `Bots.tsx` BEFORE adding the App.tsx import (or do both in immediate succession) so a typecheck or dev-server reload between the two never sees a dangling import.

## Steps

### Phase 0 — Confirm starting state
- [ ] 1. Confirm the previous "multi-bot" plan's Phase 0 deletions are already reflected on disk: `apps/server/src/db/repos/bots.ts`, `apps/server/src/api/routes/bots.ts`, `apps/web/src/pages/Bots.tsx`, the `bots` query key entry, the `Bot`/`CreateBotBody`/`UpdateBotBody` types, the `getBotForChat` reference in `router.ts`, and the registerBotRoutes call in `api/index.ts` should all be ABSENT. (Already verified during planning.) Migration `0011_bots.sql` (creating the `bots` / `bot_chats` tables) is left in place — no destructive drop.

### Phase 1 — Shared types and config
- [ ] 2. Edit `packages/shared/src/types.ts`:
  - Extend `Chat.chat_type` union to include `'bot'`.
  - Add `interface TelegramBotConfig { id: string; token: string; system_prompt: string; enabled: boolean; webhook_secret: string; created_at: string; }`.
  - Add `interface UpdateTelegramBotConfigBody { token?: string; system_prompt?: string; enabled?: boolean; }`.
- [ ] 3. Run `pnpm -F @tele/shared build` so `apps/server` and `apps/web` typecheck can resolve the new exports.
- [ ] 4. Add `PUBLIC_URL: z.string().url().optional()` to `apps/server/src/config.ts`'s zod schema.

### Phase 2 — DB migration & repo
- [ ] 5. Write `apps/server/src/db/migrations/0012_telegram_bot_config.sql` (idempotent):
  - `CREATE TABLE IF NOT EXISTS telegram_bot_config ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token TEXT NOT NULL UNIQUE, system_prompt TEXT NOT NULL DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT TRUE, webhook_secret TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now() );`
  - `CREATE UNIQUE INDEX IF NOT EXISTS telegram_bot_config_singleton ON telegram_bot_config((TRUE));` (singleton enforcement)
  - Replace UNIQUE constraint on `chats(tg_chat_id)` with composite `(tg_chat_id, chat_type)`. Use `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_tg_chat_id_key; CREATE UNIQUE INDEX IF NOT EXISTS chats_tg_chat_id_chat_type_key ON chats(tg_chat_id, chat_type);` — split-on-`;`-safe, idempotent.
  - Extend `chats.chat_type` CHECK to allow `'bot'`. Postgres CHECK constraints can be modified with `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_chat_type_check; ALTER TABLE chats ADD CONSTRAINT chats_chat_type_check CHECK (chat_type IN ('private','group','channel','bot'));` — idempotent via `IF EXISTS`.
  - Top-of-file comment: "Adds singleton telegram_bot_config; extends chats UNIQUE+CHECK to support chat_type='bot'. Old bots/bot_chats tables (migration 0011) intentionally left in place for rollback safety."
- [ ] 6. Write `apps/server/src/db/repos/telegramBotConfig.ts` with:
  - `getTelegramBotConfig(): Promise<TelegramBotConfig | null>`
  - `setTelegramBotConfig(patch: UpdateTelegramBotConfigBody & { token?: string }): Promise<TelegramBotConfig>` — upsert; `webhook_secret` auto-generated on first insert via `crypto.randomBytes(32).toString('hex')`. Empty patch → reject. Uses `hasOwnProperty` per lessons-2026-04-30.
  - `clearTelegramBotConfig(): Promise<void>` (DELETE FROM telegram_bot_config; the singleton constraint guarantees at most one row exists.)
  - `setEnabled(enabled: boolean): Promise<TelegramBotConfig>`.
- [ ] 7. Edit `apps/server/src/db/repos/chats.ts` `upsertChat` (read first to see current ON CONFLICT target). If `ON CONFLICT (tg_chat_id)`, change to `ON CONFLICT (tg_chat_id, chat_type)`. Verify `chat_type` is part of the INSERT row (it should already be, since `chat_type` is a column).

### Phase 3 — Bot API client + util
- [ ] 8. Write `apps/server/src/util/safeEqual.ts`:
  ```ts
  import { timingSafeEqual } from "node:crypto";
  export function safeEqualHeader(actual: string | string[] | undefined, expected: string): boolean {
    if (typeof actual !== "string") return false;
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  ```
- [ ] 9. Write `apps/server/src/telegram/botApi.ts`:
  - Generic `botApi<T>(token: string, method: string, body?: unknown): Promise<T>` POSTs JSON to `https://api.telegram.org/bot${token}/${method}`, parses `{ ok, result, description }` envelope, throws `Error(description)` on `ok: false`. Logs the method name (NOT the token) on error.
  - Typed wrappers (each one constructs the JSON body and forwards to `botApi`):
    - `setWebhook(token, { url, secret_token, allowed_updates? })`
    - `deleteWebhook(token, drop_pending_updates?)`
    - `sendMessage(token, { chat_id, text, reply_markup?, parse_mode? })` → returns `{ message_id, chat: { id }, date }`
    - `answerCallbackQuery(token, { callback_query_id, text?, show_alert? })`
    - `editMessageReplyMarkup(token, { chat_id, message_id, reply_markup })`
    - `setMyCommands(token, { commands })` where `commands: { command: string; description: string }[]`
    - `setChatMenuButton(token, { chat_id?, menu_button })`

### Phase 4 — Reply adapter + tools
- [ ] 10. Write `apps/server/src/telegram/botSender.ts`:
  - Define and export `interface ReplyAdapter { sendText(text: string, replyMarkup?: unknown): Promise<{ message_id: string | null }>; persistOutbound(text: string, tgMessageId: string | null): Promise<void>; }`.
  - `makeBotReplyAdapter(token: string, tgChatId: string, dbChatId: string): ReplyAdapter` — `sendText` calls `botApi.sendMessage` (text, optional `reply_markup`), returns `{ message_id }`; `persistOutbound` calls `insertMessage({ chat_id: dbChatId, tg_message_id, direction: 'out', source: 'ai', text })`, calls `bumpChatActivity`, emits `message:sent` via eventBus.
- [ ] 11. Write `apps/server/src/ai/tools/botMessages.ts`:
  - `makeBotMessageTools(token: string, tgChatId: string): ToolDef[]` returning 4 tools:
    - `send_message_with_buttons({ text: string, buttons: { text, callback_data }[][], parse_mode? })` — calls `botApi.sendMessage` with `{ chat_id: tgChatId, text, reply_markup: { inline_keyboard: buttons }, parse_mode }`. Returns `{ ok, message_id }`. Note: the AI loop's MAIN reply text should come from the AI's text response, NOT this tool — but the tool exists so the AI can SEND additional message(s) with buttons (e.g., a menu) before its final text reply.
    - `set_bot_commands({ commands: { command, description }[] })` — calls `setMyCommands`. Returns `{ ok }`.
    - `set_chat_menu_button({ menu_button: { type: 'commands' | 'web_app' | 'default', text?, web_app? } })` — calls `setChatMenuButton` with `chat_id: tgChatId`. Returns `{ ok }`.
    - `edit_message_buttons({ message_id, buttons: { text, callback_data }[][] })` — calls `editMessageReplyMarkup`. Returns `{ ok }`.
- [ ] 12. Edit `apps/server/src/ai/tools/index.ts`:
  - Extend `buildTools(currentChatId, tgChatId)` to `buildTools(currentChatId, tgChatId, opts?: { isBot?: boolean; botToken?: string })`.
  - When `opts?.isBot && opts?.botToken`: append `...makeBotMessageTools(opts.botToken, tgChatId)` to the `defs` array.
- [ ] 13. Edit `apps/server/src/ai/responder.ts`:
  - Import `ReplyAdapter` type from `../telegram/botSender.js`.
  - Extend `opts` to `opts?: { systemInstructionOverride?: string; replyAdapter?: ReplyAdapter; isBot?: boolean; botToken?: string }`.
  - Pass `{ isBot: opts?.isBot, botToken: opts?.botToken }` to `buildTools(chat.id, chat.tg_chat_id, ...)`.
  - After `runToolLoop` returns `text` (and after the prefix/`finalText` step): if `opts?.replyAdapter`, call `const { message_id } = await opts.replyAdapter.sendText(finalText)` then `await opts.replyAdapter.persistOutbound(finalText, message_id)`. Else fall back to existing `sendReply(chat, finalText, "ai")`.
  - Gate the post-reply `sendReaction(chat.tg_chat_id, incomingTgMsgId, settings.reaction_done)` call on `!opts?.replyAdapter` (Bot API has no `sendReaction` analogue in v1; document inline).

### Phase 5 — Bot update handler
- [ ] 14. Write `apps/server/src/ai/botUpdateHandler.ts` exporting `handleBotUpdate(update: TelegramUpdate): Promise<void>`:
  - `getTelegramBotConfig()` → if null or `enabled=false`, return early.
  - Branch on update kind:
    - `update.message?.text` (text message): extract `tgChatId = String(message.chat.id)`, `userText = message.text`, sender first/last/username from `message.from`. Upsert chat (`chat_type='bot'`), insertMessage(`direction='in', source='user', text=userText, tg_message_id=String(message.message_id)`), `incUnread`, `bumpChatActivity`, emit `message:new`.
    - `update.callback_query`: fire-and-forget `void botApi.answerCallbackQuery(config.token, { callback_query_id: cb.id }).catch(err => logger.warn(...))` IMMEDIATELY before any other work. Then upsert chat from `cb.message.chat`, insertMessage (`direction='in', source='user', text='[Button: ' + cb.data + ']', tg_message_id=String(cb.message.message_id)`), emit `message:new`.
    - `update.poll_answer`: upsert chat from `pa.user`, insertMessage (`direction='in', source='user', text='[Poll vote: option indexes ' + pa.option_ids.join(",") + ']'`), emit `message:new`.
    - Other update fields: ignore (return).
  - Build `replyAdapter = makeBotReplyAdapter(config.token, tgChatId, dbChat.id)`.
  - Call `await generateAndReply(updatedChat, userText, Number(message.message_id), { systemInstructionOverride: config.system_prompt || undefined, replyAdapter, isBot: true, botToken: config.token })`. Note: passing `systemInstructionOverride: undefined` lets the existing system prompt build run (good fallback if config.system_prompt empty).
  - Wrap whole body in `try { ... } catch (err) { logger.error("bot update failed", { err: err.message }); }` — never re-throw.

### Phase 6 — Webhook & CRUD routes
- [ ] 15. Write `apps/server/src/api/routes/telegramBotWebhook.ts`:
  - Top-of-file comment: "PUBLIC route. Auth bypass relies on the global onRequest hook in api/index.ts:35 only intercepting `/api/*`. If that scope widens, add `/webhook/*` to PUBLIC_PATHS."
  - Register `app.post("/webhook/telegram-bot", handler)` (no `:botId` param — singleton).
  - Handler:
    - `const config = await getTelegramBotConfig();` — if null or `!config.enabled`, return `200 { ok: true }` silently.
    - Read `req.headers['x-telegram-bot-api-secret-token']`; `safeEqualHeader(header, config.webhook_secret)`. Mismatch → `reply.code(401).send({ error: 'unauthorized' })`. (401 is the documented Telegram back-off signal.)
    - Parse `req.body as TelegramUpdate` (no zod — Telegram's update shape is large and we only access narrow fields; defensive `?.` access).
    - `void handleBotUpdate(req.body).catch(err => logger.error("bot update async error", { err: err.message }))`.
    - `return reply.code(200).send({ ok: true });`
- [ ] 16. Write `apps/server/src/api/routes/telegramBot.ts`:
  - `GET /api/telegram-bot` → `{ config: TelegramBotConfig | null }`.
  - `PUT /api/telegram-bot` → validates body with `z.object({ token: z.string().min(20).optional(), system_prompt: z.string().optional(), enabled: z.boolean().optional() }).strict()`. Calls `setTelegramBotConfig(body)`. Catches `23505` → `reply.code(409).send({ error: 'token already in use' })`. After save, if `config.PUBLIC_URL` set AND saved row `enabled=true`: call `setWebhook(saved.token, { url: \`${config.PUBLIC_URL}/webhook/telegram-bot\`, secret_token: saved.webhook_secret, allowed_updates: ['message', 'callback_query', 'poll_answer'] })`. Wrap setWebhook in try/catch; log errors but do not fail the API response — return saved row regardless.
  - `PATCH /api/telegram-bot/enabled` → body `{ enabled: boolean }`. Calls `setEnabled(enabled)`. On enabled=true: setWebhook (same as PUT). On enabled=false: deleteWebhook(saved.token).
  - `DELETE /api/telegram-bot` → loads current row; if present, best-effort `deleteWebhook(row.token)` (try/catch, log warning); then `clearTelegramBotConfig()`. Return `{ ok: true }`.
- [ ] 17. Edit `apps/server/src/api/index.ts`:
  - Add imports for `registerTelegramBotRoutes` and `registerTelegramBotWebhookRoute`.
  - `await` both registrations BEFORE the static plugin (line 64) and `setNotFoundHandler` (line 69). The auth-hook (line 35-43) only matches `/api/*`, so `/webhook/telegram-bot` bypasses naturally — no `PUBLIC_PATHS` change needed.
  - Add a one-line comment `// register before setNotFoundHandler to ensure webhook route resolves` near the `registerTelegramBotWebhookRoute` call.

### Phase 7 — Dashboard
- [ ] 18. Write `apps/web/src/pages/Bots.tsx`:
  - Use `useQuery` for `GET /api/telegram-bot` (key: `qk.telegramBot`).
  - Local draft state seeded from `q.data?.config`. Form fields:
    - `token` — `<input type="password" />` with paste-friendly UX.
    - `system_prompt` — `<textarea rows={6} />`.
    - `enabled` — `<input type="checkbox" />`.
    - Read-only computed `webhook_url`: `(import.meta.env.VITE_PUBLIC_URL || '<set PUBLIC_URL on server>') + '/webhook/telegram-bot'` shown as monospace text.
  - "Save" button → `useMutation` calling `PUT /api/telegram-bot`; invalidates `qk.telegramBot`.
  - "Delete config" button (with `confirm()`) → `DELETE /api/telegram-bot`.
  - Help text below the form: "To rotate the webhook secret, delete the config and save it again — there is no in-place rotate. Make sure `PUBLIC_URL` is set on the server (env var) so Telegram can deliver updates."
  - Form layout mirrors `Settings.tsx` styling.
- [ ] 19. Edit `apps/web/src/lib/queryKeys.ts`: add `telegramBot: ["telegramBot"] as const`.
- [ ] 20. Edit `apps/web/src/components/Sidebar.tsx`: add `{ to: "/bots", label: "Bots" }` to the `items` array (place before "Settings").
- [ ] 21. Edit `apps/web/src/App.tsx`: add `import Bots from "./pages/Bots";` and `<Route path="/bots" element={<Bots />} />` inside the existing `<Routes>`. Atomicity: write `Bots.tsx` (step 18) BEFORE saving this file so a typecheck / hot-reload in between never sees a dangling import.

### Phase 8 — Build + typecheck (deferred to verification agent per executor convention)
- [ ] 22. (Verifier) `pnpm -F @tele/shared build` (already done in step 3 but re-run after all server/web edits for safety).
- [ ] 23. (Verifier) `pnpm -F @tele/server typecheck`; if the script does not exist, fall back to `cd apps/server && npx tsc --noEmit` and check exit code explicitly per lessons-2026-04-30.
- [ ] 24. (Verifier) Same for `apps/web`.
- [ ] 25. (Verifier) Boot the server (`pnpm dev`) — confirm migration `0012_telegram_bot_config.sql` runs without error and the API listens. The old `bots` and `bot_chats` tables (migration 0011) should still exist; the new `telegram_bot_config` table should be created with the singleton index.
- [ ] 26. (Verifier) Manual smoke against acceptance criteria below (or document which can be exercised given environment constraints).

## Acceptance criteria
1. `telegram_bot_config` table exists after migration with the documented columns and singleton UNIQUE index. The pre-existing `bots`, `bot_chats` tables (from migration 0011) are still present (no destructive migration).
2. `chats` table now has `UNIQUE(tg_chat_id, chat_type)` (replacing the old `UNIQUE(tg_chat_id)`), and the `chat_type` CHECK constraint accepts `'bot'`.
3. `GET /api/telegram-bot` returns `{ config: null }` initially. After `PUT /api/telegram-bot { token, system_prompt, enabled: true }`, the row is created with an auto-generated `webhook_secret`. If `PUBLIC_URL` is set, `setWebhook` is called against the Bot API.
4. A second `PUT` with a different valid token UPDATES the existing row (same id, same secret); a `PUT` whose token collides with another (deleted+recreated) value would return 409 — but in practice the singleton design means there is no second row to collide with. (Singleton + UNIQUE token still gives 23505 → 409 mapping for safety; the path is rare.)
5. `POST /webhook/telegram-bot` with the wrong `X-Telegram-Bot-Api-Secret-Token` returns `401`. With the correct header and a `message` update body, returns `200` within ~10ms (AI work runs async via fire-and-forget).
6. A `callback_query` update arriving at the webhook causes `answerCallbackQuery` to fire IMMEDIATELY (verified by Bot API call log) before the AI loop completes, AND a synthetic message `[Button: <data>]` is inserted in the `messages` table for the originating bot chat, AND the AI generates a follow-up reply that is sent via `sendMessage`.
7. `PATCH /api/telegram-bot/enabled { enabled: false }` calls `deleteWebhook`; subsequent webhook POSTs return 200 silently with no AI invocation. `PATCH ... { enabled: true }` re-registers the webhook.
8. `DELETE /api/telegram-bot` calls `deleteWebhook` (best-effort) then removes the row.
9. The dashboard `/bots` page renders the single-form UI; saving works; toggling enabled works; delete with confirm works.
10. The AI tool `send_message_with_buttons` is exposed to Gemini ONLY in bot-typed chats (verified by inspecting `buildTools` registry size for a bot chat vs. a normal chat). When the AI calls it during a bot conversation, an `inline_keyboard` message reaches Telegram and a press-back to the webhook routes through `handleBotUpdate` → `[Button: ...]` → AI → reply.
11. Server typecheck passes (`pnpm -F @tele/server typecheck` or direct `npx tsc --noEmit`); web typecheck passes; shared package builds.
12. Bot conversations show up in the dashboard Sessions view (because they're regular `chats` rows now with `chat_type='bot'`); ChatList renders them; ChatView shows message history including `[Button: ...]` synthetic turns.

## Risks
- **Webhook unreachable in local dev (PUBLIC_URL unset).** Bot config save still succeeds with a logged warning; the developer needs a tunnel (ngrok / cloudflared) and `PUBLIC_URL` set to receive updates. The dashboard could surface a "webhook not registered" badge as a follow-up — not in v1.
- **Token leakage.** The bot token is stored plaintext in `telegram_bot_config.token` and returned by `GET /api/telegram-bot` for the dashboard's edit form to pre-populate. The dashboard is password-gated, so the surface is the same as `DASHBOARD_PASSWORD`. Token is never written to logs (verified at `botApi.ts` boundary). If we wanted defense-in-depth: encrypt at rest with a passphrase derived from `DASHBOARD_PASSWORD` — out of scope for v1.
- **`Chat.chat_type` union widening cascades.** Any existing `switch (chat.chat_type)` consumer that has a `default:` branch could silently swallow `'bot'` chats. Audit: server `router.ts` has an `if/else if/else` chain with an `else { return }` fallback — bot chats from the GramJS event stream would not exist (bot updates come via webhook), so the GramJS `else` branch is unreachable for bot chats. Web `ChatList.tsx` / `ChatView.tsx` need a quick read to confirm they don't switch on chat_type — they likely just render `first_name` / `username` / `tg_chat_id` and are agnostic to chat_type.
- **`chats.tg_chat_id` UNIQUE constraint replacement.** The migration `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_tg_chat_id_key` assumes the constraint name follows Postgres's default. If a previous migration named it differently, the `IF EXISTS` makes the drop a no-op and the new index goes in cleanly — but the old UNIQUE remains, blocking the same `tg_chat_id` appearing for both a GramJS chat and a bot chat. Mitigation: the migration body inspects `pg_constraint` to find any UNIQUE on `(tg_chat_id)` and drops it dynamically — OR the simpler form: `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_tg_chat_id_key, DROP CONSTRAINT IF EXISTS chats_tg_chat_id_unique;` covering both common naming conventions. If neither matches, the verifier will see UNIQUE violations on first bot DM and we adjust the migration with a `psql \d chats` lookup.
- **Singleton constraint `((TRUE))`.** The unique-index-on-constant trick is supported in Postgres but visually surprising. Alternative: a CHECK constraint on a synthetic `singleton` column with default 0 and UNIQUE. Either works; the index form is one less column. Doc-comment in the migration explains.
- **`generateAndReply`'s history fetch (`getRecentForAi`) pulls from the same `messages` table.** Bot chats now share that table, so the AI sees the full bot conversation as context — desired behavior. But it also means a chat that has been BOTH a GramJS DM AND a bot DM (different chat_type, different chat row, same `tg_chat_id`) will have two separate history streams. Document as an intentional separation; the dashboard UI will show two Sessions entries for that user.
- **`callback_data` payload size.** Telegram caps `callback_data` at 64 bytes. The AI must produce short callback strings; document this in the `send_message_with_buttons` tool description so Gemini doesn't generate 200-byte JSON blobs that fail. Tool handler can validate length and return `{ ok: false, error: 'callback_data > 64 bytes' }` for the AI to retry.
- **`reply_markup` shape passed through Gemini.** Gemini tool args are JSON-serializable, so passing a 2D `buttons: [[{ text, callback_data }]]` array works directly. The `as any` cast (lessons-2026-05-02) may be needed when the tool handler constructs the Bot API request body since Bot API's `InlineKeyboardMarkup` type is loose.
- **`setWebhook` race with concurrent `PUT` requests.** Two simultaneous saves could race; the second `setWebhook` wins. Acceptable for a single-user dashboard. No locking needed.
- **`runToolLoop`'s 6-iteration cap.** A bot conversation that triggers a `send_message_with_buttons` tool then gets a callback_query → new AI turn → another tool call could chain quickly. Each WEBHOOK call gets its own 6-iteration budget; this is fine. The cap is per-update, not per-conversation.
- **Migration ordering with the existing `chats_tg_chat_id_key` UNIQUE.** A live database with rows already in `chats` will accept the constraint swap unless there are duplicate `(tg_chat_id, chat_type)` pairs in flight (unlikely; current code never sets `chat_type='bot'`). Verified safe for any current live DB.
- **`packages/shared` rebuild needed for both `Chat.chat_type` widening AND new `TelegramBotConfig` types.** Doing both in one diff to step 2/3 avoids the need to rebuild twice.
- **Dashboard field for `system_prompt` is also in the global `settings.persona`.** v1 makes them independent: the bot uses `telegram_bot_config.system_prompt`, the GramJS auto-reply uses `settings.persona`. If they should be linked, that's a follow-up — making them independent first lets the user diverge them per-bot vs per-account. Documented in the dashboard help text ("Bot system prompt is independent from the user-account persona in Settings.").
- **Atomic write for `Bots.tsx` + `App.tsx` import.** Per lessons-2026-05-04 (atomic delete-then-recreate phases), write `Bots.tsx` first, then add the `import Bots from "./pages/Bots"` line in `App.tsx` — never the reverse and never with a typecheck/commit in between.
