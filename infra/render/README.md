# Render free deploy

Operator runbook for deploying `tele` to Render's free Web Service tier.

## Trade-offs (read first)

- **Sleeps after 15 min idle** → keepalive needed (UptimeRobot, free, no card). On wake, GramJS reconnects via existing keepalive/watchdog (~5-10s).
- **No persistent volume** on free tier → `WORKSPACE_ROOT=/tmp/workspace` is ephemeral (lost on cold-start). User-account session lives in `SESSION_STRING` env (immutable across restarts). Bot session regenerates from bot token.
- **750 hours/month** cap → 24/7 = 720h, fits but tight.
- **No card required** for signup or deploy.
- **Cold-start every ~15-30 min** if pinger interval > 15 min. Use 5-min interval.

## Phase A — Local pre-auth (one-time)

1. From repo root: `pnpm tg-login`. Walk through phone/2FA/login code prompts.
2. Copy session bytes: `cat data/session.txt | pbcopy`.
3. Save string somewhere safe.

## Phase B — Branch ready

Branch `render`:
- `Dockerfile` and `.dockerignore` at repo root
- `apps/server/src/util/logger.ts` — file write env-gated (`LOG_FILE`)
- `apps/server/src/telegram/client.ts` — `loadSession()` prefers `SESSION_STRING` over file
- `apps/server/src/telegram/botClient.ts` — same with `BOT_SESSION_STRING`; `BOT_SESSION_FILE` env-configurable

## Phase C — Local docker smoke (recommended)

```bash
docker build -t tele-test .
docker run --rm -p 3000:3000 \
  --env-file .env \
  -e WORKSPACE_ROOT=/tmp/workspace \
  tele-test
```

`curl http://localhost:3000/api/health` → expect `{ "telegram_connected": true, ... }`.

## Phase D — Render UI configuration

1. Sign into [render.com](https://render.com) (no card).
2. **New** → **Web Service**.
3. **Connect GitHub** → authorize → select repo `piyushmantri/tele-ai`.
4. **Branch**: `render`.
5. **Runtime**: `Docker` (auto-detected from Dockerfile).
6. **Region**: pick closest (Singapore/Frankfurt/Oregon).
7. **Plan**: `Free`.
8. **Auto-Deploy**: enable (deploys on push to `render`).
9. **Environment** → add (mark sensitive ones as Secret):

   | Name | Value |
   |---|---|
   | `TG_API_ID` | from `.env` |
   | `TG_API_HASH` | from `.env` |
   | `GEMINI_API_KEY` | from `.env` |
   | `DATABASE_URL` | Neon URL |
   | `DASHBOARD_PASSWORD` | strong password |
   | `SESSION_STRING` | paste from Phase A |
   | `WORKSPACE_ROOT` | `/tmp/workspace` |
   | `INFLUXDB_URL` `_TOKEN` `_ORG` `_BUCKET` | optional |
   | `GEMINI_MODEL` `GEMINI_IMAGE_MODEL` | optional |

   Skip `SESSION_FILE`, `BOT_SESSION_FILE`, `LOG_FILE`. Render sets `PORT` automatically (10000 by default).

10. **Health Check Path**: `/api/health`.
11. Click **Create Web Service**. Wait for build (~3-5 min) then deploy. Watch logs for `"ready"` JSON line.

## Phase E — Sleep prevention via UptimeRobot

1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free, no card).
2. **Add New Monitor**:
   - Type: `HTTP(s)`
   - URL: `https://<your-app>.onrender.com/api/health`
   - Interval: 5 minutes
3. Save. Monitor pings every 5 min → Render sees traffic → never sleeps.

## Phase F — Verify live deploy

1. `https://<your-app>.onrender.com/api/health` → expect 200 + JSON body.
2. Browser → `https://<your-app>.onrender.com/` → log in with `DASHBOARD_PASSWORD`.
3. Send Telegram DM → check Render logs for routing entry.
4. Push trivial change to branch `render` → confirm Render auto-rebuilds + redeploys.

## Phase G — Promote to `main` (optional)

```bash
git checkout main
git merge render
git push
```

In Render dashboard → Settings → switch branch from `render` → `main`.

## Common issues

- **First request slow after sleep**: ~10-30s cold start. UptimeRobot pinger eliminates this.
- **Session expiry**: re-run `pnpm tg-login` locally → update `SESSION_STRING` env in Render → manual redeploy.
- **OOM**: Render free is 512 MB RAM. Tight for Node + GramJS + bot client. If crashes, disable bot client temporarily via dashboard's Bots page.
- **Workspace files lost on cold-start**: by design (no volume on free tier). AI file tools should treat workspace as scratch.
- **Custom MCP binaries**: only `npx`-based MCPs work out-of-box. Python/Go MCPs need Dockerfile additions + redeploy.
- **750h/month cap**: 24/7 = 720h, fits with 30h headroom. Avoid running multiple Render instances on the same account.
