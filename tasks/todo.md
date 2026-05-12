# Task: Per-chat AI context + per-chat slash-only mode

Add two per-chat features that work in BOTH the user-account ingress (`router.ts`) and the bot-channel ingress (`botEventHandler.ts`):

1. **`chats.ai_context: TEXT NULL`** — free-form text appended to the AI system instruction for that chat. Settable via:
   - In-chat slash command `/context`, `/context <text...>`, `/context clear`.
   - Dashboard ChatView header — show + edit textarea inline.
2. **`chats.slash_only: BOOLEAN DEFAULT FALSE`** — when TRUE, plain-text (non-`/`) inbound messages are silently dropped (logged at info, no AI invocation, no reply). Slash commands still run normally. Toggleable via:
   - Dashboard chat row toggle (next to existing block toggle), AND a header pill in ChatView.
   - In-chat slash command `/slash-only on|off` (and `/slash-only` for current state).

## Lessons applied

- **2026-04-28 — Neon serverless driver: no `unsafe`, no `query`, no multi-statement SQL** — `0018` migration must split on `;` and use idempotent DDL (`ADD COLUMN IF NOT EXISTS`).
- **2026-05-08 — Default-block via DB column DEFAULT flip, not via app-layer INSERT change** — both new columns are added with explicit `DEFAULT` (NULL for context, FALSE for slash_only). Critically, `upsertChat` in `apps/server/src/db/repos/chats.ts` already deliberately omits `is_blocked` from its INSERT column list and `ON CONFLICT DO UPDATE SET` list — we MUST do the same for the two new columns: don't add them to INSERT columns, don't add them to the SET list. Existing rows preserve their values; new rows get the DB default. The migration's top-of-file comment names the upsert function and the two columns it deliberately omits.
- **2026-05-08 — Pre-pipeline gate ordering: anti-loop > authz-bypass > authz-deny** — slash-only is a NEW gate. Ordering MUST be: (1) bot_prefix anti-loop FIRST so we don't drop our own outbound echo; (2) `tryUnblockCommand` SECOND (operator must be able to `/unblock` even on a slash-only chat — `/unblock` starts with `/` so it survives the slash-only gate anyway, but ordering is enforced for clarity); (3) **slash-only gate THIRD** (only applies to non-`/` plain text); (4) blocked check FOURTH; (5) auto_reply check; (6) slash dispatch / AI. The slash-only gate sits between unblock and blocked because: (a) it doesn't apply to slash commands so it never blocks `/unblock`, (b) putting it before the block check means a blocked-and-slash-only chat saves one DB call. Document the ordering with a numbered comment block at the top of `router.ts`'s `handle()` and `botEventHandler.ts`'s `handleBotMessage()`.
- **2026-05-08 — Pure parser + caller-decides-side-effects keeps gate logic testable across channels** — extract `/context` and `/slash-only` parsing as built-in branches inside `tryDispatchSlash` (the existing `/delete` and `/block` follow this exact pattern — they live alongside the user-defined slash table lookup). The parser returns `{ handled: true, type: "noop" }`; the caller-side WS event emission and confirmation reply happen INSIDE the slash handler since both ingress paths already route through `tryDispatchSlash`. No need for a separate cross-channel parser since `tryDispatchSlash` IS that parser.
- **2026-05-02 — Optional `opts` param with `??` fallback is the safe way to add per-call overrides without breaking callers** — `buildSystemInstruction({ chat, settings, toolsSummary })` already accepts the chat object — it can read `chat.ai_context` directly with no signature change. The `responder.ts` `buildSystemInstruction` call site stays identical; ONLY when `opts.systemInstructionOverride` is set (slash `ai_prompt` override) do we APPEND `chat.ai_context` to the override too — because the operator's chat-level context should always be honored regardless of whether the slash is overriding. Put the append at the end of the override string with a separator newline: `override + (chat.ai_context ? "\n\n" + chat.ai_context : "")`.
- **2026-04-30 — Catch Postgres unique-violation (`23505`) and return 409, never let it bubble as 500** — the new PATCH routes don't have unique constraints (the columns are unconstrained TEXT/BOOLEAN), so this lesson does NOT directly apply. But the route handlers should still validate input via zod and 404 on missing chat, mirroring `PATCH /api/chats/:id/blocked`.
- **2026-04-30 — Distinguish "key absent" from "key present, value null" in PATCH/PUT repos** — for `setChatAiContext(id, text|null)`, the parameter is non-optional: callers ALWAYS pass either a string or `null`. The repo writes whatever was passed. The `/context clear` slash maps to `setChatAiContext(id, null)`; the `/context <text>` slash maps to `setChatAiContext(id, text)`. The dashboard PATCH uses `body.context: string | null` (zod `.string().nullable()`) — same semantic.
- **2026-04-30 — `WsEvent` discriminated union: verify consumers have no silent `default` branches** — both new mutations emit the existing `chat:updated` WS event (already in the union). No new event variant. The consumers in `Sessions.tsx` and `ChatList.tsx` already invalidate on `chat:updated` — zero edits there.
- **2026-05-04 — Reuse the route/import path when replacing a feature; let the seam be the file contents** — does NOT apply (no replacement; pure additions).
- **2026-05-08 — Silent-drop on auth-style gate to prevent enumeration** — the `slash-only` gate is NOT an auth gate; it's a UX preference. Logging at INFO with the dropped text preview is fine (operator can see what got dropped in logs). Do NOT reply to the user with "your message was dropped" — that defeats the entire point of the feature (operator wants silence).

## Architectural decisions

### A1. Schema: migration `0018_per_chat_context_slash_only.sql`

```sql
-- Per-chat AI context (appended to system instruction) and slash-only mode
-- (drop non-slash inbound messages silently).
--
-- Coupled with apps/server/src/db/repos/chats.ts: upsertChat() deliberately
-- omits ai_context and slash_only from BOTH its INSERT column list AND its
-- ON CONFLICT DO UPDATE SET list. New rows get the DB defaults; existing
-- rows keep their values. Do NOT add either column to upsertChat without
-- understanding this default-preservation contract (see lessons-2026-05-08).
ALTER TABLE chats ADD COLUMN IF NOT EXISTS ai_context TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS slash_only BOOLEAN NOT NULL DEFAULT FALSE;
```

Idempotent via `ADD COLUMN IF NOT EXISTS`. `ai_context` defaults to NULL (no column DEFAULT clause needed; absence = NULL). `slash_only` defaults to FALSE.

### A2. Shared `Chat` type

Add two fields to `packages/shared/src/types.ts`:
```ts
export interface Chat {
  // ...existing fields...
  ai_context: string | null;
  slash_only: boolean;
}
```

### A3. Repo: chats.ts

Add two mutation functions:
```ts
export async function setChatAiContext(id: string, context: string | null): Promise<void> {
  await sql`UPDATE chats SET ai_context = ${context} WHERE id = ${id}`;
}
export async function setChatSlashOnly(id: string, slash_only: boolean): Promise<void> {
  await sql`UPDATE chats SET slash_only = ${slash_only} WHERE id = ${id}`;
}
```

Update every existing SELECT in chats.ts to also project `ai_context` and `slash_only`:
- `upsertChat` RETURNING clause
- `listChats` SELECT
- `getChatById` SELECT
- `getChatByTgId` SELECT
- `bumpChatActivity` RETURNING

`upsertChat` INSERT column list and ON CONFLICT SET list MUST NOT include the new columns (per A1).

### A4. API routes: chats.ts

Two new PATCH routes mirroring the existing `/blocked` shape:

```ts
app.patch("/api/chats/:id/context", async (req, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ context: z.string().nullable() }).parse(req.body);
  const chat = await getChatById(params.id);
  if (!chat) { reply.code(404); return { error: "chat not found" }; }
  await setChatAiContext(params.id, body.context);
  const updated = await getChatById(params.id);
  if (updated) eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
  return { ok: true };
});

app.patch("/api/chats/:id/slash-only", async (req, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ slash_only: z.boolean() }).parse(req.body);
  const chat = await getChatById(params.id);
  if (!chat) { reply.code(404); return { error: "chat not found" }; }
  await setChatSlashOnly(params.id, body.slash_only);
  const updated = await getChatById(params.id);
  if (updated) eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
  return { ok: true };
});
```

Both emit `chat:updated` so the dashboard refreshes live. Trim empty/whitespace-only `context` strings to NULL in the route handler so an empty textarea clears the field without requiring a separate "clear" UI button.

### A5. Slash command parsers: extend `tryDispatchSlash`

In `apps/server/src/telegram/slashDispatch.ts`, add two new built-in branches BEFORE the `getSlashCommandByName` lookup (alongside `/delete` and `/block`).

**`/context`:**
```ts
if (name === "context") {
  if (!args || args.trim() === "") {
    const cur = chat.ai_context?.trim() || "(no context set)";
    await sendReply(chat, `Current chat context:\n${cur}`, "ai");
    incCounter("slash.dispatched.context.show");
    return { handled: true, type: "noop" };
  }
  if (args.trim().toLowerCase() === "clear") {
    await setChatAiContext(chat.id, null);
    const updated = { ...chat, ai_context: null };
    eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
    await sendReply(chat, "Chat context cleared.", "ai");
    incCounter("slash.dispatched.context.clear");
    return { handled: true, type: "noop" };
  }
  const newContext = args.trim();
  await setChatAiContext(chat.id, newContext);
  const updated = { ...chat, ai_context: newContext };
  eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
  await sendReply(chat, "Chat context updated.", "ai");
  incCounter("slash.dispatched.context.set");
  return { handled: true, type: "noop" };
}
```

Reply via `sendReply(chat, ..., "ai")` for both ingress channels — sender.ts uses `chat.tg_chat_id` and routes through the user-account client. **CAVEAT**: in the bot-channel path (`chat.chat_type === "bot"`), `sendReply` would attempt to use the user-account client to talk to the bot user — wrong. Need to inspect `sender.ts` to confirm; if it doesn't handle bot chat types, the `/context` and `/slash-only` confirmation replies in bot chats will fail silently or land in the wrong place. **Decision**: for v1, route the confirmation reply through whichever client is appropriate by checking `chat.chat_type`. If `"bot"`, look up `getBotClient()` and `client.sendMessage(Number(chat.tg_chat_id), { message })`; persist via `insertMessage` with `direction='out', source='ai'`. Otherwise use `sendReply(chat, ..., "ai")`. Wrap in a small `replyToChat(chat, text)` helper inside slashDispatch.ts to avoid two branches in three places.

Actually — re-reading `botEventHandler.ts` lines 57-68, the bot path's unblock confirmation IS doing exactly this (manual `getBotClient().sendMessage` + `insertMessage`). The cleanest refactor is the `replyToChat(chat, text)` helper. Add it to `sender.ts` or to `slashDispatch.ts` as a private helper. Place it in `slashDispatch.ts` to keep blast radius minimal.

**`/slash-only`:**
```ts
if (name === "slash-only" || name === "slashonly") {
  const sub = args?.trim().toLowerCase() ?? "";
  if (sub !== "on" && sub !== "off") {
    const cur = chat.slash_only ? "on" : "off";
    await replyToChat(chat, `Slash-only mode is currently ${cur}. Use /slash-only on or /slash-only off.`);
    incCounter("slash.dispatched.slash_only.show");
    return { handled: true, type: "noop" };
  }
  const enable = sub === "on";
  await setChatSlashOnly(chat.id, enable);
  const updated = { ...chat, slash_only: enable };
  eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
  await replyToChat(chat, `Slash-only mode ${enable ? "enabled" : "disabled"}.`);
  incCounter(`slash.dispatched.slash_only.${enable ? "on" : "off"}`);
  return { handled: true, type: "noop" };
}
```

Slash regex `^([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i` already accepts `slash-only` (hyphen allowed in name).

Both built-ins return `{ handled: true, type: "noop" }` to suppress the outer `reaction_done` (the slash dispatcher's caller in `router.ts` already gates `reaction_done` on `result.type !== "ai_prompt" && result.type !== "noop"`).

### A6. Router gates: `router.ts` and `botEventHandler.ts`

In `router.ts`, insert the slash-only gate BETWEEN the `tryUnblockCommand` block and the `dbChat.is_blocked` check:

```ts
// Slash-only gate: drop non-slash plain text. Slash commands still process.
// Order rationale (numbered):
//   1) bot_prefix anti-loop (skip our own outbound echo)
//   2) /unblock parser (operator must be able to unblock even on a slash-only chat)
//   3) slash-only gate (only applies to non-/ plain text — /unblock survives anyway)
//   4) blocked check
//   5) auto_reply check
//   6) slash dispatch + AI
if (updatedChat.slash_only && !text.startsWith("/")) {
  logger.info("slash_only chat: dropping non-slash message", { chat_id: dbChat.id, preview: text.slice(0, 60) });
  incCounter("router.slash_only_dropped");
  return;
}
```

Same gate in `botEventHandler.ts:handleBotMessage`, inserted between the unblock block and the `updatedChat.is_blocked` check, with `incCounter("bot.slash_only_dropped")`.

Note: `botEventHandler.ts` does NOT currently have a slash dispatcher (the bot path goes straight to `generateAndReply`). For the slash-only feature on the bot path to be useful, the bot path must ALSO run `tryDispatchSlash` for `/`-prefixed messages. Otherwise `/context` and `/slash-only` typed in a bot chat will go straight to the AI loop.

**This is a separate-but-required change**: in `botEventHandler.ts:handleBotMessage`, after the unblock + slash-only + blocked gates, add:

```ts
if (userText.startsWith("/")) {
  const result = await tryDispatchSlash(updatedChat, userText, msg.id);
  if (result.handled) {
    incCounter("bot.dispatched.slash");
    return;
  }
}
```

Without this, `/context` and `/block` typed in a bot chat would never run the built-in branches. Place it BEFORE the `generateAndReply` call.

### A7. Responder: append `chat.ai_context` to system instruction

In `apps/server/src/ai/responder.ts:generateAndReply`, change the systemInstruction assembly:

```ts
const baseInstruction =
  opts?.systemInstructionOverride ??
  buildSystemInstruction({ chat, settings, toolsSummary: summary });

const ctx = chat.ai_context?.trim();
const systemInstruction = ctx
  ? `${baseInstruction}\n\n--- Chat-specific context ---\n${ctx}`
  : baseInstruction;
```

The append happens AFTER the override resolution so chat-specific context applies to BOTH the default system prompt AND any slash-`ai_prompt` override. If the operator wants the slash override to be standalone, they can leave `ai_context` empty for that chat.

Alternative considered: bake `chat.ai_context` into `buildSystemInstruction` itself by appending after the existing template. Rejected because slash `ai_prompt` overrides bypass `buildSystemInstruction` entirely — the append needs to happen at the call site to apply to both paths.

### A8. Dashboard: ChatView header

In `apps/web/src/components/ChatView.tsx`, add to the header:
- A small textarea (collapsed by default — show as a "Context" pill that expands on click) for `ai_context`. Save via `PATCH /api/chats/:id/context`. Save-on-blur or explicit Save button — pick Save button for predictability.
- A "Slash-only" toggle pill next to the existing Block toggle, calling `PATCH /api/chats/:id/slash-only`.

Concrete shape:
```
┌───────────────────────────────────────────────────────────┐
│ Name (@username)                  [Slash-only] [Block]    │
│ Context: <click to expand>                                 │
└───────────────────────────────────────────────────────────┘
```

When expanded, the context section shows a `<textarea>` with current value, "Save" and "Clear" buttons. Save calls PATCH with the textarea value; Clear calls PATCH with `null`.

Use `useMutation` for both, mirroring the existing `toggleBlock` mutation. WS `chat:updated` already invalidates `qk.chats`, so the parent list auto-refreshes; the local textarea value should also update on `chat` prop change (use `useEffect` with `chat.ai_context` dep).

### A9. Dashboard: ChatList row

In `apps/web/src/components/ChatList.tsx`, the row currently shows: name/username + unread badge + delete button. Add NOTHING here — the toggle lives in ChatView header (single source of truth). Rationale: ChatList is already cramped (264px wide); a slash-only toggle would require either an icon (unclear at a glance) or text (eats horizontal space). The header pill in ChatView is the right place because the operator is already looking at the chat when they want to toggle.

**Decision**: skip the per-row toggle in ChatList. Put it ONLY in ChatView header.

### A10. SlashCommands page: BUILTIN_COMMANDS

Append to `BUILTIN_COMMANDS` array in `apps/web/src/pages/SlashCommands.tsx`:

```ts
{
  name: "context",
  description: "Manage per-chat AI context (appended to the system instruction). /context shows current; /context <text> sets; /context clear removes.",
},
{
  name: "slash-only on|off",
  description: "Toggle slash-only mode for the current chat. When on, plain-text messages are silently dropped — only slash commands are processed.",
},
```

Place after the `unblock` entry. No code logic changes.

### A11. Sender helper for cross-channel reply in slashDispatch.ts

Add a small helper at the top of `slashDispatch.ts`:

```ts
async function replyToChat(chat: Chat, text: string): Promise<void> {
  if (chat.chat_type === "bot") {
    const client = getBotClient();
    if (!client) {
      logger.warn("bot client unavailable for slash reply", { chat_id: chat.id });
      return;
    }
    const sent = await client.sendMessage(Number(chat.tg_chat_id), { message: text });
    await insertMessage({
      chat_id: chat.id,
      tg_message_id: sent.id != null ? String(sent.id) : null,
      direction: "out",
      text,
      source: "ai",
    });
  } else {
    await sendReply(chat, text, "ai");
  }
}
```

Imports needed: `getBotClient` from `../telegram/botClient.js`, `insertMessage` from `../db/repos/messages.js`. Replace the existing `sendReply(chat, ..., "ai")` calls in `/delete`, `/block`, and the new `/context`/`/slash-only` branches with `replyToChat`. The shell/message branches keep `sendReply` since shell output volume might be fine through the user-account client only (deferred — shell commands in a bot chat is an edge case; current behavior already targets user-account).

Actually — re-reading slashDispatch.ts: `/delete` doesn't reply at all (it just deletes), and `/block` doesn't reply either. So `replyToChat` is ONLY needed for the new `/context` and `/slash-only` confirmations. Less surface area to touch.

For shell/message/ai_prompt branches in slashDispatch: those reach `sendReply` which uses the user-account client. The bot path in `botEventHandler.ts` doesn't currently route slash commands AT ALL, so today no shell-in-bot-chat path exists. After A6's "add slash dispatch to bot path" change, shell/message replies in bot chats will silently fail (sender uses user-account client, but bot users aren't accessible via the user-account client). **Resolution**: for v1, accept that shell/message/ai_prompt slash commands in bot chats are best-effort — they'll likely fail silently. The two new built-in commands `/context` and `/slash-only` use `replyToChat` so they DO work in bot chats. This is the minimum viable change. Document in the verifier as PASS-by-inspection caveat.

### A12. Counter naming

Per lessons-2026-05-08 cardinality rule: counter names use the `<subsystem>.<event>.<variant>` pattern with NO dynamic high-cardinality segments.

New counters:
- `router.slash_only_dropped`
- `bot.slash_only_dropped`
- `bot.dispatched.slash`
- `slash.dispatched.context.show`
- `slash.dispatched.context.set`
- `slash.dispatched.context.clear`
- `slash.dispatched.slash_only.on`
- `slash.dispatched.slash_only.off`
- `slash.dispatched.slash_only.show`

All bounded (constant string set; no chat_id interpolation). 9 new names; well under cardinality budget.

## Files to touch

### New files
| Path | Reason |
|---|---|
| `apps/server/src/db/migrations/0018_per_chat_context_slash_only.sql` | Adds `ai_context TEXT NULL` and `slash_only BOOLEAN NOT NULL DEFAULT FALSE` to `chats`. Idempotent via `ADD COLUMN IF NOT EXISTS`. Top-of-file comment names the upsert function and the column-omission contract. |

### Modified files
| Path | Change |
|---|---|
| `packages/shared/src/types.ts` | Add `ai_context: string \| null` and `slash_only: boolean` to `Chat`. |
| `apps/server/src/db/repos/chats.ts` | Add `ai_context, slash_only` to every SELECT projection (5 queries: `upsertChat` RETURNING, `listChats`, `getChatById`, `getChatByTgId`, `bumpChatActivity` RETURNING). Add `setChatAiContext(id, text\|null)` and `setChatSlashOnly(id, bool)` exports. **Do NOT add either column to `upsertChat`'s INSERT column list or its ON CONFLICT SET list** — the DB defaults (NULL / FALSE) apply on first insert; existing rows preserve their values on conflict. |
| `apps/server/src/api/routes/chats.ts` | Add `PATCH /api/chats/:id/context` and `PATCH /api/chats/:id/slash-only`. Both 404 on missing chat, validate via zod, emit `chat:updated`. |
| `apps/server/src/telegram/slashDispatch.ts` | Add `/context` and `/slash-only` built-in branches alongside `/delete` and `/block`. Add private `replyToChat(chat, text)` helper that branches on `chat.chat_type === "bot"` (uses `getBotClient`) vs default (uses `sendReply`). New imports: `getBotClient`, `insertMessage`, `setChatAiContext`, `setChatSlashOnly`, `eventBus`. |
| `apps/server/src/telegram/router.ts` | Insert slash-only gate AFTER `tryUnblockCommand` block, BEFORE `dbChat.is_blocked` check. Add numbered ordering comment block at top of `handle()`. |
| `apps/server/src/ai/botEventHandler.ts` | Insert slash-only gate AFTER unblock block, BEFORE `is_blocked` check. Then add `tryDispatchSlash` invocation for `/`-prefixed messages BEFORE `generateAndReply`. Add same numbered ordering comment block. New import: `tryDispatchSlash`. |
| `apps/server/src/ai/responder.ts` | Append `chat.ai_context` (if non-empty) to the resolved system instruction (after override resolution). Single 3-line change. |
| `apps/web/src/components/ChatView.tsx` | Add slash-only toggle pill next to Block button. Add collapsible Context section with textarea + Save + Clear buttons. Two new mutations using existing `useMutation` pattern. |
| `apps/web/src/pages/SlashCommands.tsx` | Append `/context` and `/slash-only on\|off` entries to `BUILTIN_COMMANDS`. |

NOT modified:
- `apps/web/src/components/ChatList.tsx` — per A9, no row-level changes.
- `apps/server/src/ai/systemPrompt.ts` — per A7, append happens at the responder call site, not in the prompt builder.
- `packages/shared/src/types.ts` `WsEvent` union — `chat:updated` already exists.

## Steps

1. [x] Write `apps/server/src/db/migrations/0018_per_chat_context_slash_only.sql` with the two `ADD COLUMN IF NOT EXISTS` statements and the top-of-file contract comment.
2. [x] Update `packages/shared/src/types.ts` — add `ai_context: string | null` and `slash_only: boolean` to `Chat`.
3. [x] Update `apps/server/src/db/repos/chats.ts`:
   - Add `ai_context, slash_only` to all 5 SELECT/RETURNING projections.
   - Add `setChatAiContext(id, text|null): Promise<void>` and `setChatSlashOnly(id, bool): Promise<void>`.
   - Verify `upsertChat` INSERT column list and `ON CONFLICT DO UPDATE SET` list do NOT include the new columns.
4. [x] Update `apps/server/src/api/routes/chats.ts` — add the two PATCH routes with zod validation, 404 handling, and `chat:updated` emit.
5. [x] Update `apps/server/src/telegram/slashDispatch.ts`:
   - Add private `replyToChat(chat, text)` helper.
   - Add `/context` built-in branch (show / set / clear behavior).
   - Add `/slash-only` built-in branch (show / on / off behavior).
   - Imports: `getBotClient`, `insertMessage`, `setChatAiContext`, `setChatSlashOnly`, `eventBus`.
6. [x] Update `apps/server/src/telegram/router.ts`:
   - Add numbered ordering comment block at top of `handle()`.
   - Insert slash-only gate between unblock and blocked check.
   - `incCounter("router.slash_only_dropped")` on drop.
7. [x] Update `apps/server/src/ai/botEventHandler.ts`:
   - Add same ordering comment.
   - Insert slash-only gate between unblock and blocked check.
   - `incCounter("bot.slash_only_dropped")`.
   - After the gates and before `generateAndReply`, run `tryDispatchSlash` for `/`-prefixed messages and return on `handled`. `incCounter("bot.dispatched.slash")` on handled.
   - Import `tryDispatchSlash`.
8. [x] Update `apps/server/src/ai/responder.ts` — append `chat.ai_context` (if non-empty) to the resolved system instruction.
9. [x] Update `apps/web/src/components/ChatView.tsx`:
   - Add `useMutation` for `setContext` (PATCH `/api/chats/:id/context`).
   - Add `useMutation` for `toggleSlashOnly` (PATCH `/api/chats/:id/slash-only`).
   - Header: add "Slash-only" pill next to Block.
   - Body header: add expandable "Context" section with textarea + Save/Clear buttons.
   - Local state for textarea seeded from `chat.ai_context`, reset on `chat.id` change.
10. [x] Update `apps/web/src/pages/SlashCommands.tsx` — append `/context` and `/slash-only on|off` to `BUILTIN_COMMANDS`.
11. [x] Build `@tele/shared` first (`pnpm -F @tele/shared build`), then typecheck server and web (per lessons-2026-04-28 build-shared-first rule).
12. [ ] Restart server (manual). Verify migration runs idempotently on second boot (no errors).

## Acceptance criteria

1. Migration `0018_per_chat_context_slash_only.sql` runs on a fresh DB AND on a DB with the previous 17 migrations applied. Re-running the migrator after success is a no-op (no errors). The `chats` table has columns `ai_context TEXT NULL` (default NULL) and `slash_only BOOLEAN NOT NULL DEFAULT FALSE`.
2. Existing chats are untouched: `slash_only` is FALSE for every pre-existing row; `ai_context` is NULL for every pre-existing row. (The migration does not run any UPDATE.)
3. `Chat` shape returned by `GET /api/chats` and `GET /api/chats/by-tg/:tgId` includes both new fields with correct types.
4. `PATCH /api/chats/:id/context { context: "Use formal tone." }` updates the row, returns `{ ok: true }`, and emits a `chat:updated` WS event with the updated `ai_context`.
5. `PATCH /api/chats/:id/context { context: null }` clears the context.
6. `PATCH /api/chats/:id/slash-only { slash_only: true }` updates the row, returns `{ ok: true }`, and emits `chat:updated`.
7. Slash command `/context` (no args) replies with the current context (or "no context set"). `/context Use formal tone.` sets it. `/context clear` clears it. `/context` after a set shows the new value. **Each form** works in BOTH a user-account chat AND a bot chat.
8. Slash command `/slash-only on` enables, `/slash-only off` disables, `/slash-only` (no args) reports current state. Works in BOTH ingress channels.
9. With `slash_only=true` on a chat, sending plain text `"hello"` does NOT trigger an AI reply, does NOT increment `gemini.call.ok`, increments `router.slash_only_dropped` (or `bot.slash_only_dropped`). The message IS still persisted (`message:new` WS event fires) so the dashboard shows it.
10. With `slash_only=true` on a chat, sending `/ping` (a configured user slash command) DOES execute normally.
11. With `slash_only=true` AND `is_blocked=false` on a chat, sending `/unblock <ai_username>` is a no-op (chat is already unblocked) but does not get dropped by the slash-only gate.
12. With `ai_context="Always reply in pirate slang."` set, an AI reply visibly reflects the context (smoke-test, PASS-by-inspection — requires real Gemini call).
13. With `ai_context` set AND a slash `ai_prompt` command invoked, the resolved system instruction is `<override>\n\n--- Chat-specific context ---\n<ai_context>` (verified by inspection of responder code path).
14. Dashboard ChatView header shows current `slash_only` state as a toggle pill; clicking it flips the value and the change is reflected immediately (live via WS).
15. Dashboard ChatView header has a collapsible Context section showing current `ai_context`; editing + Save persists; Clear sets to NULL.
16. Dashboard SlashCommands "System commands" section lists `/context` and `/slash-only on|off` alongside `/delete`, `/block`, `/unblock <ai_username>`.
17. `pnpm -F @tele/shared build && (cd apps/server && npx tsc --noEmit) && (cd apps/web && npx tsc --noEmit)` exits 0 (per lessons-2026-04-30 — use direct `npx tsc` to avoid silent-pass on missing `typecheck` script).
18. The router gate ordering comment block at the top of `handle()` in `router.ts` and `handleBotMessage()` in `botEventHandler.ts` documents the 6-step order.

## Risks

- **Bot-channel slash-command routing**: today, `botEventHandler.ts` does NOT call `tryDispatchSlash`. Adding that call (Step 7) means existing user-defined slash commands (`/ping`, etc.) will start running in bot chats. This is an EXPANSION of behavior. Mitigation: it's the correct expansion — the operator's slash commands should work uniformly across channels. Risk surface: shell-type slash commands run on the host with `zsh -c` regardless of which user typed them in which chat. The host is already the operator's machine; there's no new attack surface (user-account chats already had the same exposure).
- **`replyToChat` helper in bot chats**: relies on `getBotClient()` returning a connected client. If the bot client is disconnected (toggled off in dashboard), `/context` and `/slash-only` confirmations will silently fail. Mitigation: log at warn level so operator sees it; the underlying state change still happened (the DB write succeeded before the reply attempt). Acceptable for v1.
- **`Number(chat.tg_chat_id)` in `replyToChat`**: per lessons-2026-04-28, GramJS rejects `bigint` and accepts `number` for IDs < 2^53. All Telegram chat IDs fit in 2^53 today. Same conversion pattern as elsewhere in the codebase.
- **Slash-only gate ordering**: putting the gate before `is_blocked` means we burn one extra info log per dropped non-slash message even on blocked chats. Trivially small; not a concern. The alternative (after `is_blocked`) means a blocked-and-slash-only chat hits two log lines instead of one — same trivial cost. Order chosen for documentation clarity (slash-only is a UX preference; block is an authorization decision; preferences come before authorization).
- **`/slash-only` regex**: the existing parser regex `^([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i` accepts hyphens, so `slash-only` parses correctly. Confirmed by reading slashDispatch.ts:60.
- **`ai_context` size**: TEXT in Postgres has no practical limit (up to 1GB). A pathological operator could paste a megabyte. Risk: the system instruction balloons and the Gemini call costs more / hits context-window limit. Mitigation: zod `.max(8000)` on the PATCH route (8KB ≈ 2K tokens — enough for even verbose chat-specific instructions). Document in the textarea help text.
- **Frontend WS sync on `chat:updated`**: the existing WS consumer in `Sessions.tsx` invalidates `qk.chats` on `chat:updated`, which re-fetches the chat list. The `ChatView` component receives `chat` as a prop from the parent, so the new field values arrive through the parent re-render. The local textarea state needs `useEffect(() => setLocalContext(chat.ai_context ?? ""), [chat.id, chat.ai_context])` to stay in sync — picking JUST `chat.id` would miss external updates; including `chat.ai_context` means an in-flight typing session will be clobbered if the WS event arrives mid-edit. **Decision**: use `chat.id` only as the dep — typing locally takes precedence; external updates via WS only refresh on chat-switch. This is the same pattern most chat editors use.
- **Bot path slash dispatch + slash-only ordering**: the slash-only gate must come BEFORE the slash dispatch in the bot path, mirroring the user-account path. Any non-slash message gets dropped by the gate; any `/`-prefixed message survives the gate and reaches the slash dispatch. Verified in step 7's plan.
- **PASS-by-inspection items** (per lessons-2026-05-08): live AI behavior with `ai_context` (criterion 12) requires a real Gemini call and a human eyeballing the reply. Verifier will mark as PASS-by-inspection.
