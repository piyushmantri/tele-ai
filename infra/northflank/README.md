# Northflank deploy

Operator runbook for deploying `tele` to Northflank Sandbox.

## Phase A — Local pre-auth (one-time)

1. From repo root: `pnpm tg-login`. Walk through the phone number / 2FA / login code prompts.
2. Copy session bytes: `cat data/session.txt | pbcopy` (single long base64 string).
3. Save it somewhere safe for pasting into Northflank in Phase D.

## Phase B — Branch already prepared

Code changes are on branch `northflank`:
- `Dockerfile` and `.dockerignore` at repo root
- `apps/server/src/util/logger.ts` — file write env-gated (`LOG_FILE`)
- `apps/server/src/telegram/client.ts` — `loadSession()` prefers `SESSION_STRING` env over file
- `apps/server/src/telegram/botClient.ts` — same with `BOT_SESSION_STRING`; `BOT_SESSION_FILE` env-configurable

## Phase C — Local docker smoke (recommended)

```bash
docker build -t tele-test .
docker run --rm -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/data:/data" \
  -e WORKSPACE_ROOT=/data/workspace \
  -e SESSION_FILE=/data/session.txt \
  -e BOT_SESSION_FILE=/data/bot-session.txt \
  tele-test
```

Then `curl http://localhost:3000/api/health` → expect `{ "telegram_connected": true, ... }`. Open `http://localhost:3000/` in browser → log in with `DASHBOARD_PASSWORD`. Stop with Ctrl+C.

## Phase D — Northflank UI configuration

1. Sign into Northflank → Create Project → name `tele`.
2. Create Combined Service (build + deploy from source). Choose `tele` project.
3. Connect GitHub → authorize Northflank to read `piyushmantri/tele-ai`.
4. Repo + branch: `piyushmantri/tele-ai`, branch `northflank`.
5. Build type: Dockerfile. Path: `/Dockerfile` (root).
6. Resources: pick the smallest Sandbox-allowed plan (256-512 MB RAM).
7. Add persistent volume (Storage tab):
   - Name: `tele-data`
   - Size: 1 GB
   - Mount path: `/data`
8. Ports tab:
   - HTTP, internal port `3000`, expose publicly. Northflank assigns a public `*.northflank.app` URL.
9. Health check (Health & Status tab):
   - HTTP, path `/api/health`, port `3000`, expected 200.
10. Environment variables (Environment tab — Secrets for sensitive):

    | Name | Value |
    |---|---|
    | `TG_API_ID` | from `.env` |
    | `TG_API_HASH` | from `.env` |
    | `GEMINI_API_KEY` | from `.env` |
    | `DATABASE_URL` | Neon connection string |
    | `DASHBOARD_PASSWORD` | choose a strong one |
    | `SESSION_STRING` | paste from Phase A step 2 |
    | `WORKSPACE_ROOT` | `/data/workspace` |
    | `SESSION_FILE` | `/data/session.txt` |
    | `BOT_SESSION_FILE` | `/data/bot-session.txt` |
    | `INFLUXDB_URL` | optional |
    | `INFLUXDB_TOKEN` | optional |
    | `INFLUXDB_ORG` | optional |
    | `INFLUXDB_BUCKET` | optional |
    | `GEMINI_MODEL` | optional override |
    | `GEMINI_IMAGE_MODEL` | optional override |

    Leave `LOG_FILE` UNSET.

11. Auto-deploy: enable "Deploy on push" for branch `northflank`.
12. Click Deploy. Watch build logs → wait for `"ready"` JSON line in runtime logs.

## Phase E — Verify live deploy

1. Hit `https://tele-<hash>.northflank.app/api/health` → expect 200 + `{ telegram_connected: true, uptime_s: <n> }`.
2. Open in browser → log in with `DASHBOARD_PASSWORD`.
3. Send a Telegram DM to your account → Northflank logs show inbound routing → AI replies if auto-reply on.
4. Push a trivial change to branch `northflank` → confirm auto-rebuild + redeploy.
5. After redeploy → confirm session persists (`SESSION_STRING` env covers it). Confirm `/data/workspace` files survive.

## Phase F — Promote to `main` (optional, after stability)

```bash
git checkout main
git merge northflank
git push
```

In Northflank, switch the service's branch from `northflank` to `main`. Optionally delete the `northflank` branch.

## Common issues

- **Session expiry**: Telegram occasionally invalidates sessions. Container fails to authenticate (no stdin for re-prompt). Re-run `pnpm tg-login` locally → update `SESSION_STRING` env var → redeploy.
- **OOM at boot**: Sandbox plan tight on RAM. Disable bot client temporarily (set `enabled=false` in dashboard's Bots page from a test deploy with bot off) and retry.
- **Custom MCP servers**: only `npx`-based MCPs work out-of-the-box. For Python/Go MCPs, add the binaries to the Dockerfile and redeploy.
- **Custom domain**: Sandbox tier gives `*.northflank.app` only. Custom domain is paid.
