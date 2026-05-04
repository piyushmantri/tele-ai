# Telegram AI Agent

A self-hosted Node.js/TypeScript personal assistant that connects to your **Telegram user account** via MTProto, uses **Google Gemini** to auto-reply to DMs, and lets Gemini run real tasks on your machine (shell commands, file I/O, scheduled reminders). A small React dashboard lets you manage sessions, settings, allow/deny lists, and reminders.

> **Single-user personal tool.** The AI can run shell commands on your host and the dashboard is protected by one shared password. Keep your `.env` secret and treat this like a privileged local agent.

---

## Features

- **AI auto-reply** — Gemini reads incoming Telegram DMs and replies on your behalf with a configurable persona
- **Function calling** — Gemini can invoke tools mid-reply:
  - `run_shell` — execute zsh commands (subject to allow/deny lists you control)
  - `read_file` / `write_file` / `list_dir` — sandboxed file I/O inside `WORKSPACE_ROOT`
  - `set_reminder` / `list_reminders` / `delete_reminder` — one-shot or recurring (cron) reminders sent back to any chat
- **React dashboard** at `localhost:5173` (dev) or `/` (prod):
  - **Sessions** — live view of all Telegram chats with unread counts
  - **Chat view** — read and send messages; see AI vs manual vs user message sources
  - **Settings** — toggle auto-reply, change persona, model, temperature, reply delay, workspace root, shell allow/deny lists
  - **Rules** — contact-level allow/block rules (by username or Telegram ID)
  - **Reminders** — full CRUD for scheduled messages
- **Audit log** — every tool call (name, args, result, success) stored in Postgres
- **WebSocket** — dashboard updates in real time as messages and tool calls arrive
- **Neon Postgres** for all persistent state; migrations run automatically on startup

---

## Prerequisites

| Requirement | Version | Where to get it |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 9+ | `npm i -g pnpm` |
| Telegram API credentials | — | https://my.telegram.org/apps |
| Google Gemini API key | — | https://aistudio.google.com/app/apikey |
| Neon Postgres | — | https://console.neon.tech (free tier works) |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/tele.git
cd tele
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TG_API_ID=           # from my.telegram.org/apps
TG_API_HASH=         # from my.telegram.org/apps
GEMINI_API_KEY=      # from aistudio.google.com
GEMINI_MODEL=gemini-2.0-flash   # or any Gemini model ID
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
DASHBOARD_PASSWORD=  # pick a strong password
PORT=3000
WORKSPACE_ROOT=/absolute/path/to/your/workspace
```

| Variable | Purpose |
|---|---|
| `TG_API_ID` / `TG_API_HASH` | MTProto credentials — one-time registration on my.telegram.org |
| `GEMINI_API_KEY` | Google AI API key |
| `GEMINI_MODEL` | Model used for replies; can be overridden per-chat in Settings |
| `DATABASE_URL` | Neon (or any Postgres) connection string with `sslmode=require` |
| `DASHBOARD_PASSWORD` | Shared password for the React dashboard |
| `PORT` | HTTP port the backend listens on (default `3000`) |
| `WORKSPACE_ROOT` | Absolute path Gemini's file tools are sandboxed to |

### 3. Telegram login (first run only)

```bash
pnpm dev:server
```

On first run the server will:

1. Apply database migrations to Neon
2. Prompt on stdin for your **phone number**, **login code** (sent by Telegram), and **2FA password** if enabled
3. Save the MTProto session string to `apps/server/data/session.txt` (chmod 0600, gitignored)

Subsequent runs load the saved session and skip all prompts.

---

## Running

### Development

```bash
pnpm dev          # server + web in parallel (recommended)
pnpm dev:server   # backend only (Fastify + Telegram + Gemini)
pnpm dev:web      # frontend only (Vite dev server, proxies /api and /ws to :3000)
```

Dashboard: http://localhost:5173 — sign in with `DASHBOARD_PASSWORD`.

### Production

```bash
pnpm build   # compiles shared types, server (tsc), and web (Vite)
pnpm start   # runs node apps/server/dist/index.js
             # serves the Vite bundle from / and API from /api
```

The production server serves the compiled frontend from the same port as the API, so you only need to expose one port.

---

## Project structure

```
apps/
  server/                    Fastify backend
    src/
      ai/                    Gemini integration
        responder.ts         Main reply loop
        systemPrompt.ts      Persona + context builder
        tools/               Function-calling tool definitions
          shell.ts           run_shell (allow/deny enforced)
          files.ts           read_file / write_file / list_dir
          reminders.ts       set_reminder / list_reminders / delete_reminder
      api/                   REST + WebSocket endpoints
        routes/
          auth.ts            Login / session
          chats.ts           Chat list + message history
          settings.ts        Get / update all settings
          rules.ts           Contact allow/block rules
          reminders.ts       Reminder CRUD
        ws.ts                WebSocket event fan-out
      db/                    Neon client, migrations, repositories
        migrations/          SQL migration files (applied in order on startup)
        repos/               chats, messages, settings, rules, reminders, audit
      scheduler/             node-cron + setTimeout for reminder delivery
      telegram/
        client.ts            GramJS MTProto connection + session persistence
        router.ts            Incoming message handler → AI responder
        sender.ts            Outbound message helper
      util/
        eventBus.ts          In-process event emitter (new messages, tool calls)
        logger.ts            Structured pino logger
  web/                       React + Vite + Tailwind dashboard
    src/
      pages/                 Login, Sessions, Settings, Rules, Reminders
      components/            TopBar, Sidebar, ChatList, ChatView, MessageBubble, Composer
      lib/                   API client, WebSocket hook, React Query keys
packages/
  shared/                    TypeScript types shared by server and web
```

---

## How it works

```
Telegram message arrives
        │
        ▼
  telegram/router.ts
    checks contact rules (allow/block)
    checks auto_reply_enabled
        │
        ▼
  ai/responder.ts
    builds system prompt (persona, contact name, current time, tool list)
    fetches recent message history from DB
    calls Gemini generateContent
        │
        ▼  (Gemini may request tools)
  ai/tools / runToolLoop
    executes up to 6 tool-call rounds
    logs each call to tool_audit_log
    emits tool:invoked event → dashboard WebSocket
        │
        ▼
  telegram/sender.ts
    sends final text reply
    stores message in DB
    emits message:new event → dashboard WebSocket
```

---

## Settings reference

All settings live in Postgres and are editable from the dashboard Settings page.

| Setting | Default | Description |
|---|---|---|
| `auto_reply_enabled` | `true` | Master on/off for AI replies |
| `persona` | (configurable) | Free-text persona injected into the system prompt |
| `user_name` | (configurable) | Your name, used in the system prompt |
| `gemini_model` | `gemini-2.0-flash` | Gemini model ID |
| `temperature` | `0.7` | Gemini sampling temperature (0–2) |
| `reply_delay_ms` | `0` | Artificial delay before sending (simulate typing) |
| `workspace_root` | from env | Root directory for file tool sandboxing |
| `shell_allow` | `[]` | Allowed shell command prefixes (empty = all allowed) |
| `shell_deny` | `["rm","sudo",...]` | Denied tokens anywhere in the command |

---

## Security

- **Shell access** — `run_shell` gives Gemini zsh execution. The deny list blocks dangerous commands by default; the allow list (empty = all allowed) lets you lock down further. Audit every tool call in the dashboard.
- **Session file** — `apps/server/data/session.txt` grants full Telegram account access. It is gitignored and created with restricted permissions. Back it up privately; rotate by deleting it and re-running `pnpm dev:server`.
- **Database password** — `DATABASE_URL` contains your Neon password. Rotate via the Neon console if leaked.
- **Dashboard password** — single shared password with a long-lived session cookie. Do not expose port 3000 (or your production port) to the public internet without additional auth (e.g., a VPN or Cloudflare Access).
- **`.env` file** — contains all secrets. Never commit it. The `.gitignore` excludes it by default.

---

## Deployment (VPS / always-on server)

1. Copy the repo to your server.
2. Install Node 20+ and pnpm.
3. Set up `.env` with production values.
4. Run `pnpm install && pnpm build`.
5. Do the one-time Telegram login interactively: `pnpm dev:server` (then Ctrl-C once logged in).
6. Run in production: `pnpm start`.

For process supervision use **systemd** or **PM2**:

```bash
# PM2 example
pm2 start "pnpm start" --name tele
pm2 save
pm2 startup
```

Keep the dashboard behind a firewall or reverse proxy with auth (nginx, Caddy, Cloudflare Access).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `SESSION_STRING not found` | Delete `data/session.txt` and re-run `pnpm dev:server` to re-login |
| Gemini not replying | Check `auto_reply_enabled` in Settings; check `GEMINI_API_KEY` |
| DB migration error | Verify `DATABASE_URL` is correct and Neon project is active |
| Shell tool blocked | Check allow/deny lists in Settings; check audit log for blocked reason |
| Dashboard shows no chats | Send a DM to your account first — chats are created on first message |

---

## License

MIT
