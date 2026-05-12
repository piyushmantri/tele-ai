# Verification: Per-chat AI context + slash-only mode

Acceptance criteria from `tasks/todo.md` lines 374-391, plus structural inspections from the verifier brief.

## Build / typecheck

| Step | Result | Evidence |
|---|---|---|
| `cd packages/shared && npx tsc -b` | PASS | exit 0 |
| `cd apps/server && npx tsc --noEmit` | PASS | exit 0 |
| `cd apps/web && npx tsc --noEmit` | PASS | exit 0 |

Acceptance #17 PASS.

## Migration (acceptance #1, #2)

File: `apps/server/src/db/migrations/0018_per_chat_context_slash_only.sql`

- Top-of-file SQL comment block (lines 1-8) names `upsertChat()` and the column-omission contract (lessons-2026-05-08).
- `ALTER TABLE chats ADD COLUMN IF NOT EXISTS ai_context TEXT;` (line 9) — idempotent, no DEFAULT clause → defaults to NULL.
- `ALTER TABLE chats ADD COLUMN IF NOT EXISTS slash_only BOOLEAN NOT NULL DEFAULT FALSE;` (line 10) — idempotent, default FALSE.
- Comments use `--` and contain no `;` (verified by inspection of all 8 comment lines).
- No UPDATE statement → existing rows untouched; `slash_only` defaults to FALSE for pre-existing rows due to `NOT NULL DEFAULT FALSE` semantics; `ai_context` is NULL for pre-existing rows (column allows NULL, no default).

Acceptance #1 PASS by inspection.
Acceptance #2 PASS by inspection.

Live boot evidence: `pnpm dev` (run twice) reaches `"ready"` in `/tmp/spaps-verify.log` and `/tmp/spaps-verify2.log` with no error or migration-failure log lines on either boot. Second boot is the no-op idempotency proof.

## Repo: `apps/server/src/db/repos/chats.ts`

- `setChatAiContext(id, context: string|null)` exported at lines 65-67.
- `setChatSlashOnly(id, slash_only: boolean)` exported at lines 69-71.
- `ai_context, slash_only` projected in:
  - `upsertChat` RETURNING (line 25)
  - `listChats` SELECT (line 34)
  - `getChatById` SELECT (line 45)
  - `getChatByTgId` SELECT (line 55)
  - `bumpChatActivity` RETURNING (line 84)
  - `searchChats` SELECT (line 102) — bonus, beyond the 5 listed in plan
- `upsertChat` INSERT column list (line 16) is `(tg_chat_id, username, first_name, last_name, chat_type)` — does NOT include `ai_context` or `slash_only`.
- `upsertChat` ON CONFLICT SET clause (lines 19-22) sets only `username, first_name, last_name, chat_type` — does NOT include either new column.
- Inline comment at lines 12-14 documents the contract.

Acceptance: structural #3 PASS (Chat shape).

## API routes: `apps/server/src/api/routes/chats.ts`

- `PATCH /api/chats/:id/context` (lines 60-70):
  - zod `z.string().max(8000).nullable()` validation (line 62).
  - 404 on missing chat (line 64).
  - Whitespace-to-null normalization at line 65 (`body.context.trim() === "" ? null : body.context`).
  - Emits `chat:updated` after re-fetch (line 68).
- `PATCH /api/chats/:id/slash-only` (lines 72-81):
  - zod `z.boolean()` validation (line 74).
  - 404 on missing chat (line 76).
  - Emits `chat:updated` after re-fetch (line 79).

Live API: with no auth cookie both routes return HTTP 401 (`{"error":"unauthorized"}`) — proves the routes are registered and reach the auth middleware. Route file imports `setChatAiContext`, `setChatSlashOnly`, `eventBus` (lines 3, 6).

Acceptance #4, #5, #6 PASS (route shape + 401 routing proof; full body cycle is PASS-by-inspection without an authenticated session).

## Slash dispatcher: `apps/server/src/telegram/slashDispatch.ts`

- `replyToChat(chat, text)` private helper at lines 24-42 branches on `chat.chat_type === "bot"`:
  - bot: `getBotClient().sendMessage(Number(chat.tg_chat_id), { message: text })` then `insertMessage` with `direction: "out", source: "ai"`. Warns if client unavailable (line 28).
  - else: `sendReply(chat, text, "ai")`.
- `/context` branch at lines 118-140, BEFORE `getSlashCommandByName` (line 162):
  - empty args → reply with current value or "(no context set)" (lines 119-124).
  - `clear` → `setChatAiContext(chat.id, null)` + emit + reply (lines 125-132).
  - text → `setChatAiContext(chat.id, args.trim())` + emit + reply (lines 133-139).
  - All three return `{ handled: true, type: "noop" }`.
  - Counters: `slash.dispatched.context.show|set|clear`.
- `/slash-only` branch at lines 145-160:
  - Accepts both `slash-only` and `slashonly`.
  - empty / non-on-off → reply with current state.
  - `on|off` → `setChatSlashOnly` + emit + reply.
  - Counters: `slash.dispatched.slash_only.{show,on,off}`.
- Branches placed alongside `/delete` (lines 94-100) and `/block` (lines 105-112), all BEFORE the user-defined slash table lookup. Imports include `getBotClient`, `insertMessage`, `setChatAiContext`, `setChatSlashOnly`, `eventBus` (lines 8-11).

Acceptance #7, #8 PASS by inspection.

## Router: `apps/server/src/telegram/router.ts`

- Numbered ordering comment block at lines 29-35 documents the 6-step gate order:
  1. bot_prefix anti-loop
  2. tryUnblockCommand
  3. slash-only gate
  4. is_blocked
  5. auto_reply
  6. tryDispatchSlash + AI
- Actual ordering matches:
  - bot_prefix skip at lines 100-105
  - tryUnblockCommand at lines 111-124
  - slash-only gate at lines 128-135 (`updatedChat.slash_only && !text.startsWith("/")` → log + `incCounter("router.slash_only_dropped")` + return)
  - is_blocked check at lines 137-142
  - auto_reply check at lines 144-148
  - tryDispatchSlash at lines 150-159 then `generateAndReply` at line 166

Acceptance #9, #10, #11, #18 PASS by inspection.

## Bot event handler: `apps/server/src/ai/botEventHandler.ts`

- Numbered ordering comment block at lines 19-25 mirrors router.ts.
- Actual ordering in `handleBotMessage`:
  - bot config check + out-skip + sender resolution at lines 27-32
  - tryUnblockCommand at lines 59-79
  - slash-only gate at lines 80-87 (`updatedChat.slash_only && !userText.startsWith("/")` → log + `incCounter("bot.slash_only_dropped")` + return)
  - is_blocked check at lines 88-91
  - tryDispatchSlash at lines 93-99 (NEW — was absent before; `incCounter("bot.dispatched.slash")` on handled)
  - generateAndReply at line 102
- Import for `tryDispatchSlash` added at line 15.

Acceptance #18 PASS, plus the bot-channel slash routing change required by the plan's A6 is in place.

## Responder: `apps/server/src/ai/responder.ts`

- Lines 57-67:
  ```
  const baseInstruction = opts?.systemInstructionOverride ?? buildSystemInstruction({...});
  const ctx = chat.ai_context?.trim();
  const systemInstruction = ctx
    ? `${baseInstruction}\n\n--- Chat-specific context ---\n${ctx}`
    : baseInstruction;
  ```
- Append happens AFTER override resolution → applies to BOTH default system prompt and slash `ai_prompt` overrides (acceptance #13).
- `systemInstruction` (not `baseInstruction`) is then passed to `getGenerativeModel` at line 71.

Acceptance #12 PASS-by-inspection (live AI behavior). Acceptance #13 PASS by inspection.

## Frontend: `apps/web/src/components/ChatView.tsx`

- `useState` for `contextOpen` and `contextDraft` seeded from `chat.ai_context` (lines 18-19).
- `useEffect` resets draft + collapses on `chat.id` change (lines 24-25).
- `toggleSlashOnly` mutation calls `PATCH /api/chats/:id/slash-only` (lines 35-36).
- `setContext` mutation calls `PATCH /api/chats/:id/context` (line 40).
- Slash-only pill in header (lines 94-103) — `Slash-only: on/off` label, click toggles via `mutate(!chat.slash_only)`.
- Collapsible Context section (lines 120-153):
  - Toggle button "Context" / "Hide context" with dot indicator when set (lines 120-124).
  - Textarea bound to `contextDraft` (line 134).
  - Save button calls `setContext.mutate(contextDraft || null)` (line 142).
  - Clear button clears local + calls `setContext.mutate(null)` (lines 150-151).

Acceptance #14, #15 PASS by inspection.

## Frontend: `apps/web/src/pages/SlashCommands.tsx`

- BUILTIN_COMMANDS entries at lines 49-58:
  - `name: "context"` with full description.
  - `name: "slash-only on|off"` with full description.
- Both placed after `unblock <ai_username>` entry as planned.

Acceptance #16 PASS by inspection.

## Shared types: `packages/shared/src/types.ts`

- `Chat.ai_context: string | null` at line 12.
- `Chat.slash_only: boolean` at line 13.

## Live boot

```
pnpm dev → /tmp/spaps-verify.log and /tmp/spaps-verify2.log
```
Both boots reach `"ready"` (final log line) with no `error`/`fatal`/migration failure.
Second boot is the idempotency proof (migration 0018 is a no-op via `IF NOT EXISTS`).

Live API smoke (server up, no auth cookie):
- `PATCH /api/chats/00000000-0000-0000-0000-000000000000/context` → 401 `{"error":"unauthorized"}` — route registered.
- `PATCH /api/chats/00000000-0000-0000-0000-000000000000/slash-only` → 401 `{"error":"unauthorized"}` — route registered.

## PASS-by-inspection items

- Acceptance #12: live AI reply visibly reflects `ai_context` (requires real Gemini call).
- Acceptance #7, #8 in-bot-chat invocations: requires live Telegram session.
- Acceptance #4-#6 full WS round-trip: requires authenticated session.

## Result

All 18 acceptance criteria PASS (verified by code inspection, structural checks, typecheck exit codes, live boot/log scrub, and live API routing probe).
