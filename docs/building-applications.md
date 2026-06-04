# Building tele Applications

A developer guide for building applications that plug into tele. Every in-repo
claim below is grounded in a specific source file; paths are cited inline so you
can verify them as the code evolves.

---

## 1. Overview

An application attaches behavior to chats. There are two app **types**:

- **`ai_only`** — a system prompt plus an optional knowledge base. No code. Fully
  managed in the dashboard. At responder time the prompt + KB are concatenated
  and injected into the AI's context (`apps/server/src/ai/applications.ts:121-132`).
- **`code`** — ships a `manifest.json` at the repo root plus `src/hook.ts`. A
  code app can run in **two runtime modes**:
  - **In-tele**: the app is assigned to a tele chat. tele's AI calls your
    hook's `getContext(chatId, ctx?)` for context injection
    (`apps/server/src/ai/applications.ts:110`, `loadCodeAppContext`) and
    `handleSlashCommand(...)` for slash commands
    (`apps/server/src/ai/applicationSlash.ts`).
  - **Standalone bot**: the app runs its OWN Telegram bot. This requires a
    `bot_config` row (with a `bot_token`) in the app's own database plus a
    per-app `database_url`. The runner in
    `apps/server/src/ai/applicationBotRunner.ts` polls for these apps and drives
    them.

The two runtime modes pass **different** context objects to your hook. See
section 4 — do not assume the fields overlap.

---

## 2. Hello World — `ai_only`

No code required. In the dashboard:

1. Go to **Applications → Add application**.
2. Set **Type** = `ai_only`.
3. Give it a **slug** (kebab/snake-case) and a **name**.
4. Fill in the **System prompt** (required for `ai_only`).
5. Optionally add a **Knowledge base** (appended after the system prompt).
6. Save, then assign it to a chat via **Manage chats** (or flip on **Global
   default** to inject it for every chat).

At responder time the system prompt (and KB, if set) is injected into the AI's
context. An empty/whitespace system prompt is skipped
(`apps/server/src/ai/applications.ts:121-132`).

---

## 3. Hello World — `code` app

A code app is an installable repo with this minimal layout:

```
my-app/
  manifest.json     # at the repo root
  src/
    hook.ts         # exports getContext(chatId)
```

### `manifest.json`

Fields validated by the manifest schema
(`apps/server/src/applications/registry.ts:13-22`):

```json
{
  "slug": "my-app",
  "name": "My App",
  "type": "code",
  "description": "",
  "required_env_vars": [],
  "system_prompt": null,
  "knowledge_base": null,
  "slash_commands": []
}
```

- `slug` must match the slug regex `^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$`
  (`registry.ts:6`) and MUST equal the registry slug it is installed under, or
  installation is rejected (`apps/server/src/applications/install.ts:156-160`).
- For `type: "code"`, `src/hook.ts` must exist on disk or installation fails
  (`install.ts:161-164`).

### `src/hook.ts`

The simplest valid hook exports `getContext(chatId)`. This is the exact body of
the only in-repo example, `apps/server/applications/uptime-monitor/hook.ts`:

```ts
// The exported getContext(chatId) is called at responder time and its return
// value is injected into the AI's system instruction.
export async function getContext(_chatId: string): Promise<string> {
  const now = new Date().toISOString();
  return `Service status snapshot (${now}):\n- api: OK\n- worker: OK\n- db: OK`;
}
```

> Note: `uptime-monitor` itself is a **demo stub** living at
> `apps/server/applications/uptime-monitor/hook.ts` — a root-level `hook.ts`
> with NO `manifest.json` and NO `src/` directory. It is NOT installable as-is;
> it only illustrates the `getContext` body shape. A real installable app uses
> the `manifest.json` + `src/hook.ts` layout shown above.

### Installing

Use the **Browse** tab on the Applications page. Add a registry entry pointing at
either:

- a **git URL** — cloned into `data/applications/<slug>/`
  (`install.ts:16`, `resolveInstalledPath`), or
- a **local path** — must be an absolute path with no leading `~`
  (`install.ts:84-101`).

Then click **Install**.

---

## 4. The hook contract

Your hook module may export:

- `getContext(chatId, ctx?)` — returns a string injected into the AI's system
  instruction. The `ctx` argument is **optional**: a 1-arg hook is valid and the
  optional `ctx?` is a signature-widening
  (`apps/server/src/ai/applications.ts:43-47`).
- `handleSlashCommand(cmd, args, chatId, ctx?)` — see section 7.
- `ensureDb(databaseUrl)` — standalone-bot only, see sections 5 and 7.

The return value of `getContext` is concatenated into the AI's system context;
return `""` to contribute nothing.

### Two ctx shapes — these do NOT overlap

The fields you receive depend on **which runtime mode** invoked your hook.

**In-tele ctx** (`apps/server/src/ai/applications.ts:35-40`,
`apps/server/src/ai/applicationSlash.ts:17-22`):

| field            | type                                                  | purpose                                   |
|------------------|-------------------------------------------------------|-------------------------------------------|
| `emit`           | `(name: string, value?: number) => void`              | increment a custom counter metric         |
| `emitTimeseries` | `(name: string, value: number) => void`               | record a point in a ring-buffered series  |
| `storeResult`    | `(data: Record<string, unknown>) => Promise<void>`    | persist a result row                      |
| `databaseUrl`    | `string \| null`                                      | the app's per-app database URL (or null)  |

**Standalone bot ctx** (`apps/server/src/ai/applicationBotRunner.ts:41`):

| field          | type             | purpose                              |
|----------------|------------------|--------------------------------------|
| `databaseUrl`  | `string`         | the app's database URL               |
| `geminiApiKey` | `string \| null` | host's Gemini API key (or null)      |
| `geminiModel`  | `string \| null` | host's Gemini model name (or null)   |

There is **no overlap** beyond `databaseUrl`. The in-tele ctx has no Gemini
fields; the standalone-bot ctx has no `emit`/`emitTimeseries`/`storeResult`.

### Defensive pattern

Because `ctx` and its fields are mode-dependent, guard before calling them:

```ts
export async function getContext(chatId: string, ctx?: {
  emit?: (name: string, value?: number) => void;
  databaseUrl?: string | null;
}): Promise<string> {
  const emit = ctx?.emit ?? (() => {});
  emit("context_built");
  // ...
  return "";
}
```

---

## 5. Database integration

1. Set the app's **Database URL** in the dashboard (Add/Edit application form).
2. Access it via `ctx.databaseUrl`. It is injected **fresh each turn** by the
   host (`apps/server/src/ai/applications.ts:63-67`) — never cache it in module
   scope, as it can change between calls.
3. Query with `@neondatabase/serverless`.

### Migration pattern

Keep DDL idempotent and track applied migrations yourself. Minimal `migrate.ts`:

```ts
import { neon } from "@neondatabase/serverless";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL
);
`;

export async function ensureDb(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  // Split on ';' and run each statement individually — the serverless driver
  // executes one statement per call.
  for (const stmt of MIGRATION.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed) await sql(trimmed, []);
  }
}
```

Notes:

- Split the `.sql` text on `;` and run each statement via `sql(stmt, [])`.
- Use `IF NOT EXISTS` so the migration is safe to re-run.
- `gen_random_uuid()` works without any extension on PostgreSQL 13+.
- Track applied migrations in a `schema_migrations` table so you can add new
  ones over time.

---

## 6. Logging & metrics

### Logging

- **Inside a hook, use `console.log` / `console.warn` only.** Do NOT import
  tele's `logger`. The hook is copied/installed as a standalone plugin; importing
  host internals couples the plugin to tele and breaks the install model.
- The host's own logger (`apps/server/src/util/logger.ts`) writes JSONL to the
  console AND appends to `/tmp/spaps-server.log` (the `LOG_FILE` constant,
  `logger.ts:6`). Because your hook's stdout runs inside the host process, your
  `console.*` output is captured alongside the host log there.

### Custom metrics (in-tele ctx only)

Available only on the in-tele ctx via the `emit` closures the host passes in:

- `ctx.emit(name)` — increment a counter
  (`apps/server/src/ai/applicationMetrics.ts`).
- `ctx.emitTimeseries(name, value)` — record a point in a ring buffer
  (240 samples per metric, `applicationMetrics.ts:37`).

Metric `name` must match `^[a-z0-9_]{1,64}$`
(`applicationMetrics.ts:36`). Both are shown per-app on the Observability page.

> **Plugin boundary:** never import `applicationMetrics` directly. The `emit`
> and `emitTimeseries` closures arrive via `ctx`; importing the host module
> would couple your plugin to tele's internals.

---

## 7. Slash commands

### 1. Declare in the manifest

Add entries to `slash_commands[]`. Each has a `name` (regex `^[a-z0-9_-]+$`) and
a `description` (1–200 chars) — `apps/server/src/applications/registry.ts:8-11`:

```json
{
  "slash_commands": [
    { "name": "status", "description": "Show current status" }
  ]
}
```

### 2. Export the handler

```ts
export async function handleSlashCommand(
  cmd: string,
  args: string,
  chatId: string,
  ctx?: { databaseUrl?: string | null },
): Promise<string> {
  if (cmd === "status") return "All systems OK";
  return "Unknown command";
}
```

The signature is `handleSlashCommand(cmd, args, chatId, ctx?)`; `ctx` is optional
(`apps/server/src/ai/applicationSlash.ts:28-34`).

### Two dispatch paths

- **In-tele**: a user-typed `/command` is matched against your manifest's
  `slash_commands` and dispatched by
  `apps/server/src/ai/applicationSlash.ts`. If two installed apps register the
  same command name, the first match wins and a warning is logged
  (`applicationSlash.ts:111-116`).
- **AI-driven (standalone bot)**: in standalone-bot mode the AI can persist data
  by emitting a `CALL: /cmd {json}` marker in its reply. The bot runner extracts
  each marker, calls `handleSlashCommand(cmd, args, chatId, ctx)`, then strips
  the markers from the text before sending the reply
  (`apps/server/src/ai/applicationBotRunner.ts:150-168`):

  ```ts
  // applicationBotRunner.ts:150 — the system instruction tells the model:
  // "When you need to persist data, emit a line starting with
  //  'CALL: /command {json}' before your reply. These lines will be executed
  //  and stripped."
  for (const match of [...reply.matchAll(CALL_RE)]) {
    const cmd = (match[1] ?? "").replace(/^\//, "");
    const args = match[2] ?? "";
    if (typeof mod.handleSlashCommand === "function") {
      await mod.handleSlashCommand(cmd, args, chatId, ctx);
    }
  }
  ```

### `ensureDb` (standalone bot only)

The optional `ensureDb(databaseUrl)` export is called **only** by the standalone
bot runner at startup, before it reads `bot_config`
(`apps/server/src/ai/applicationBotRunner.ts:209-210`). It is NOT a universal
hook export; the in-tele path never calls it. Use it to run your migrations once
when the bot boots.

---

## 8. Debugging

- **Restart the server after editing `hook.ts`.** Hooks are loaded via dynamic
  `import()` and cached by the ESM module loader; they are NOT hot-reloaded.
- **Grep `/tmp/spaps-server.log`** for these host warnings:
  - `application hook load failed` — the dynamic import of your `hook.ts` threw
    (`apps/server/src/ai/applications.ts:79`); check the `err` field.
  - `hook import failed` — the standalone bot runner could not import your hook
    (`applicationBotRunner.ts:107`).
  - `code app missing installed_path` — the app row has no install path; re-install
    from the **Browse** tab (`apps/server/src/ai/applications.ts:140`).
  - `bot_config does not exist` — **benign**; it just means this app's database
    has no `bot_config` table, i.e. it is not a standalone-bot app. The runner
    skips it silently (`applicationBotRunner.ts:269-270`).
- **Standalone smoke test** of your `getContext`:

  ```sh
  tsx -e "import('./src/hook.ts').then(m => m.getContext('1').then(console.log))"
  ```

- **GramJS gotcha**: `EntityLike` rejects `bigint`. Use `Number(...)` or a
  string for Telegram IDs when calling GramJS APIs.

---

## Appendix: external example app

`counseller` is a fuller, externally-installable app that lives **outside this
repo** (at the sibling path `~/spaps/counseller`). It is referenced here only as
an example of a complete app with its own migrations and standalone-bot setup.
Because it is out-of-tree, none of its code is verifiable from this repo — treat
the in-repo source citations above as authoritative and counseller as
illustrative only.
