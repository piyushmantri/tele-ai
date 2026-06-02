# Dockerize tele — Draft Plan

## Task
Dockerize the tele monorepo so `docker compose up` starts: server, web (nginx static), local Postgres (replacing Neon), and the Elastic stack (ES + Logstash + Kibana) — with named volumes for DB, ES, server data (workspace/session/applications), and logs.

## Lessons applied
- **lessons-2026-04-28 (Neon driver has no `unsafe`/`query`/multi-statement)** — switching off Neon means we must keep the migrator's "split on `;`, call `sql(stmt, [])`" loop working AND keep DDL idempotent (`IF NOT EXISTS`). The new driver wrapper in `apps/server/src/db/index.ts` must expose the SAME two call shapes (tagged template + `sql(text, params)`) so `db/migrate.ts` and every repo file under `db/repos/` keep working without per-callsite edits.
- **lessons-2026-05-15 (DSN regex must cover `postgres://` AND `postgresql://`)** — the existing `maskedDatabaseUrl()` in `config.ts` uses `new URL()` so it's already scheme-agnostic; preserve. Local DSN uses `postgres://tele:tele@postgres:5432/tele` (no `sslmode=require` for the local container, so the new driver must skip TLS when the DSN omits it).
- **lessons "ISO is the convention for Elasticsearch-indexed log lines"** (line 704 of lessons.md) — the server logger already emits ISO `t:` in JSONL to stdout AND `/tmp/spaps-server.log`. Logstash can ingest stdout via docker's GELF log driver with no server-side code change.
- **No new lesson required for Postgres BIGINT chat IDs** — local Postgres uses the same wire protocol; types map identically. The `postgres.js` package returns BIGINT as `string` by default, matching Neon's behavior — verifies the existing `db/repos/chats.ts` contract.

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  docker compose (network: tele_net, with healthchecks)  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ postgres │  │ elastic  │  │ logstash               │ │
│  │  :5432   │  │  :9200   │  │  :12201/udp (gelf)     │ │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────────┘ │
│       │             │                 │                 │
│  ┌────▼─────────────▼─────────────────▼──────────────┐  │
│  │ server  (Fastify, :3000)                          │  │
│  │   - DATABASE_URL=postgres://tele:***@postgres/tele│  │
│  │   - stdout → docker gelf driver → logstash → ES   │  │
│  │   - volumes: tele_data (workspace, session, apps) │  │
│  └────┬──────────────────────────────────────────────┘  │
│       │                                                 │
│  ┌────▼──────┐   ┌──────────┐                           │
│  │ web/nginx │   │  kibana  │                           │
│  │   :8080   │   │   :5601  │                           │
│  └───────────┘   └──────────┘                           │
└─────────────────────────────────────────────────────────┘
```

Named volumes (persisted across container restarts AND `docker compose down`): `pg_data`, `es_data`, `tele_data` (covers `data/` and `workspace/`).

## Files to touch

| File | Reason |
|---|---|
| `apps/server/package.json` | Add `postgres@^3.4.4` (Porsager's `postgres.js`) for the local PG client; `@neondatabase/serverless` becomes unused but stays in deps for now (separate cleanup PR — minimum-impact rule). |
| `apps/server/src/db/index.ts` | Replace `neon(DATABASE_URL)` with a `postgres.js` client; expose the SAME `sql` tagged template + `sql(text, params)` direct-call shape so `db/migrate.ts` and every `db/repos/*.ts` file keep working unmodified. Keep retry wrapper. Set `ssl: false` when DSN lacks `sslmode=require`. |
| `apps/server/src/config.ts` | No change to schema. Verified `DATABASE_URL` is just a `z.string().min(1)` — it accepts both `postgres://` and `postgresql://`. |
| `apps/server/Dockerfile` (NEW) | Multi-stage: install pnpm, build `@tele/shared` + `@tele/server`, copy `dist/` + migrations + `applications/` registry; runtime image is `node:20-alpine` with `git` (needed by the plugin installer in `applications/install.ts`) and `tini` for PID 1. |
| `apps/web/Dockerfile` (NEW) | Multi-stage: build vite → nginx:alpine serving `dist/` with `/api` + `/ws` proxied to `server:3000`. |
| `apps/web/nginx.conf` (NEW) | SPA fallback + API/WS reverse proxy to upstream `server:3000`. |
| `docker-compose.yml` (NEW, repo root) | Defines 6 services: postgres, elasticsearch, logstash, kibana, server, web. Named volumes. Healthchecks. `depends_on` with `condition: service_healthy` on postgres for the server. |
| `infra/elastic/logstash.conf` (NEW) | Input: GELF/UDP 12201 (from docker `gelf` log driver). Filter: parse JSON inside `message` field. Output: elasticsearch (index `tele-logs-%{+YYYY.MM.dd}`). |
| `.dockerignore` (NEW, repo root) | Exclude `node_modules`, `data/`, `workspace/`, `.env`, `dist/`, `.git/`, `tasks/`. |
| `.env.docker.example` (NEW, repo root) | Template for compose: `POSTGRES_PASSWORD`, `TG_API_ID/HASH`, `GEMINI_API_KEY`, `DASHBOARD_PASSWORD`, etc. Compose reads via implicit `.env` lookup. |
| `README.md` | Add a "Run with Docker" section (~30 lines) explaining `cp .env.docker.example .env && docker compose up`. |

**Files intentionally NOT touched** (to minimize blast radius):
- Every `db/repos/*.ts` — they call `sql\`…\`` only; the new `db/index.ts` keeps that shape.
- `apps/server/src/util/logger.ts` — already JSONLs to stdout AND `/tmp/spaps-server.log`. Docker captures stdout; Logstash ingests it via the GELF driver. The `/tmp/...` write is harmless inside the container (writes to the container's own tmpfs).
- `apps/web/vite.config.ts` — dev-only proxy; in prod the nginx config takes over.
- `apps/server/src/api/index.ts` — already binds `0.0.0.0:3000` (verified line 93).

## Steps

### Phase 1: DB driver swap (so the server can talk to a real Postgres)
- [ ] 1. Add `"postgres": "^3.4.4"` to `apps/server/package.json` dependencies. Run `pnpm install` to refresh the lockfile.
- [ ] 2. Rewrite `apps/server/src/db/index.ts`:
  - `import postgres from "postgres";`
  - Build the client: `const _client = postgres(config.DATABASE_URL, { ssl: /sslmode=require/i.test(config.DATABASE_URL) ? "require" : false, max: 10, idle_timeout: 30, prepare: false });`
  - `prepare: false` is important because the migrator splits files on `;` and runs each statement individually; prepared-statement caching across DDL is a footgun.
  - Define a local function-overload type that captures BOTH shapes used by existing callers:
    ```ts
    type SqlFn = {
      <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
      <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
    };
    ```
  - Implement the wrapper:
    - When called as tagged template (first arg `Array.isArray(strings) && "raw" in strings`), forward to `_client(strings, ...values)` — postgres.js supports tagged-template natively.
    - When called as `sql(text, params)`, call `_client.unsafe(text, params)` — postgres.js HAS this method (unlike Neon, where its absence caused lessons-2026-04-28).
  - Wrap BOTH call paths through the existing `sqlWithRetry` (rename internally if needed). Transient-error list (`fetch failed`, `ECONNRESET`, `ETIMEDOUT`, `connecting to database`) still matches TCP postgres errors.
  - Replace the existing `export const sql = ... as NeonQueryFunction<false, false>` cast with `export const sql = wrappedSql as unknown as SqlFn;`. No repo file changes.
  - Keep `export async function query<T>(text, params): Promise<T[]>` — implement via `_client.unsafe<T[]>(text, params)` with the same retry loop.
- [ ] 3. Verify `cd apps/server && npx tsc -p tsconfig.json --noEmit` passes (the new wrapper's structural type must satisfy every callsite). If any repo file imports `NeonQueryFunction` directly, replace with the local `SqlFn`. (Grep confirms only `db/index.ts` imports from `@neondatabase/serverless`.)
- [ ] 4. Smoke test against a local postgres: `docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pw postgres:16-alpine && DATABASE_URL=postgres://postgres:pw@localhost:5433/postgres pnpm --filter @tele/server dev` — confirm migrations run, server starts, then `docker rm -f` the throwaway container.

### Phase 2: Server container
- [ ] 5. Create `apps/server/Dockerfile`:
  ```dockerfile
  # ---- build stage
  FROM node:20-alpine AS build
  RUN apk add --no-cache git python3 make g++
  WORKDIR /app
  RUN npm i -g pnpm@10.33.0
  COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
  COPY packages/ packages/
  COPY apps/server/package.json apps/server/
  COPY apps/web/package.json apps/web/
  COPY vendor/ vendor/
  RUN pnpm install --frozen-lockfile
  COPY apps/server/ apps/server/
  RUN pnpm --filter @tele/shared build && pnpm --filter @tele/server build

  # ---- runtime stage
  FROM node:20-alpine
  RUN apk add --no-cache git tini ca-certificates
  WORKDIR /app
  COPY --from=build /app/node_modules ./node_modules
  COPY --from=build /app/packages ./packages
  COPY --from=build /app/apps/server/dist ./apps/server/dist
  COPY --from=build /app/apps/server/src/db/migrations ./apps/server/dist/db/migrations
  COPY --from=build /app/apps/server/package.json ./apps/server/
  COPY --from=build /app/apps/server/applications ./apps/server/applications
  ENV NODE_ENV=production
  EXPOSE 3000
  ENTRYPOINT ["/sbin/tini","--"]
  CMD ["node","apps/server/dist/index.js"]
  ```
  Notes: migrations get copied next to compiled JS so the `__dirname`-based path in `migrate.ts` resolves at runtime. `applications/registry` and `applications/uptime-monitor` are baked into the image; user-installed plugins land under `/app/data/applications` (`install.ts:16` uses `join(process.cwd(), "data", "applications")` and cwd is `/app`).

### Phase 3: Web container
- [ ] 6. Create `apps/web/Dockerfile`:
  ```dockerfile
  FROM node:20-alpine AS build
  WORKDIR /app
  RUN npm i -g pnpm@10.33.0
  COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
  COPY packages/ packages/
  COPY apps/server/package.json apps/server/
  COPY apps/web/package.json apps/web/
  COPY vendor/ vendor/
  RUN pnpm install --frozen-lockfile
  COPY apps/web/ apps/web/
  RUN pnpm --filter @tele/shared build && pnpm --filter @tele/web build

  FROM nginx:alpine
  COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
  COPY --from=build /app/apps/web/dist /usr/share/nginx/html
  EXPOSE 80
  ```
- [ ] 7. Create `apps/web/nginx.conf`:
  ```nginx
  upstream backend { server server:3000; }
  server {
    listen 80;
    root /usr/share/nginx/html;
    client_max_body_size 50m;
    location /api/ { proxy_pass http://backend; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_read_timeout 300s; }
    location /ws  { proxy_pass http://backend; proxy_http_version 1.1;
                    proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
                    proxy_read_timeout 3600s; }
    location /    { try_files $uri /index.html; }
  }
  ```

### Phase 4: docker-compose.yml
- [ ] 8. Create `docker-compose.yml` at repo root with 6 services (postgres, elasticsearch, logstash, kibana, server, web). Key points:
  - `postgres:16-alpine`, `pg_isready` healthcheck, volume `pg_data:/var/lib/postgresql/data`, password from `${POSTGRES_PASSWORD:-tele}`.
  - `elasticsearch:8.13.4`, single-node, `xpack.security.enabled=false`, `ES_JAVA_OPTS=-Xms512m -Xmx512m`, volume `es_data:/usr/share/elasticsearch/data`, curl healthcheck against `_cluster/health`.
  - `logstash:8.13.4`, mounts `./infra/elastic/logstash.conf` ro, port `12201/udp` published to host so the docker daemon's gelf driver can reach it.
  - `kibana:8.13.4`, `ELASTICSEARCH_HOSTS=http://elasticsearch:9200`.
  - `server`: built from `apps/server/Dockerfile`, depends_on `postgres { condition: service_healthy }` and `logstash { condition: service_started }`, env vars piped from `.env`, volumes `tele_data:/data` AND `tele_data:/app/data` (deliberate double-mount — config defaults point to `/data` while `install.ts` uses cwd-relative `data/applications`), logging driver `gelf` → `udp://localhost:12201`.
  - `web`: built from `apps/web/Dockerfile`, depends_on `server`, ports `8080:80`.
  - Top-level `volumes: { pg_data: {}, es_data: {}, tele_data: {} }`.
- [ ] 9. Create `infra/elastic/logstash.conf`:
  ```
  input {
    gelf { port => 12201 type => "docker" }
  }
  filter {
    if [type] == "docker" {
      json { source => "message" skip_on_invalid_json => true target => "app" }
    }
  }
  output {
    elasticsearch {
      hosts => ["http://elasticsearch:9200"]
      index => "tele-logs-%{+YYYY.MM.dd}"
    }
  }
  ```
- [ ] 10. Create `.env.docker.example` with placeholders for all required env vars (`POSTGRES_PASSWORD`, `TG_API_ID`, `TG_API_HASH`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `DASHBOARD_PASSWORD`). Document that `DATABASE_URL` is set by compose and should NOT be overridden.
- [ ] 11. Create root `.dockerignore`: `node_modules`, `**/node_modules`, `**/dist`, `data`, `workspace`, `.env`, `.git`, `tasks`, `*.log`.

### Phase 5: Wiring & docs
- [ ] 12. Add a "Run with Docker" section to `README.md`:
  - Prereqs: Docker Desktop (or Docker Engine 24+ with compose v2 plugin); Linux hosts may need `sysctl -w vm.max_map_count=262144` for Elasticsearch.
  - `cp .env.docker.example .env`, fill in Telegram + Gemini creds.
  - `docker compose up -d --build`.
  - First-run Telegram user-account login: requires an interactive TTY for the verification code. Documented procedure:
    1. Stop the container: `docker compose stop server`.
    2. Run `pnpm tg-login` on the host once (writes `data/session.txt`).
    3. `docker cp ./data/session.txt $(docker compose ps -aq server):/data/session.txt`, OR temporarily bind-mount `./data` over the named volume.
    4. `docker compose start server`. The bot now runs headless forever (session is in the named volume).
  - Open `http://localhost:8080` for the dashboard, `http://localhost:5601` for Kibana (in Kibana → Discover → create data view `tele-logs-*`).
  - Reset everything: `docker compose down -v` (drops named volumes — destroys DB and logs).

## Acceptance criteria
1. `docker compose up -d --build` from a clean checkout brings all 6 containers to a healthy state within 120 seconds. `docker compose ps` shows server/web/postgres/kibana/logstash/elasticsearch all running, postgres + elasticsearch marked healthy.
2. `docker compose exec postgres psql -U tele -d tele -c '\dt'` lists all tables created by migrations 0001–0027 (the migrator ran on first boot).
3. `curl -s http://localhost:3000/api/health` (or whichever existing health route is registered in `apps/server/src/api/index.ts` — to be confirmed during execution) returns 200.
4. `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` returns 200 and `curl -s http://localhost:8080/api/health` proxies through to the server (also 200).
5. Open `http://localhost:5601` → Discover. After creating a data view for `tele-logs-*`, server log lines (with `app.msg`, `app.level`, `app.t` parsed fields from the JSON-decoded message) are visible.
6. `docker compose restart server` and a subsequent `psql -c 'SELECT count(*) FROM chats;'` returns the same row count as before the restart. The Telegram session file persists.
7. `docker compose down && docker compose up -d` (without `-v`) preserves all data. `docker compose down -v && docker compose up -d` starts fresh (Postgres re-applies all migrations from `0001_init.sql` through `0027_drop_application_bot_configs.sql`).
8. `cd apps/server && npx tsc -p tsconfig.json --noEmit` passes on the host (the DB driver swap doesn't break types).

## Risks
- **Postgres driver swap breaks an obscure callsite.** Mitigation: keep the function signature compatible; run full `tsc` on server; grep for any direct import of `neon` or `NeonQueryFunction` outside `db/index.ts` (none found).
- **`postgres.js` parses BIGINT as `string` by default; Neon does too.** Existing repos that read `tg_chat_id` should be unaffected, but spot-check `db/repos/chats.ts` for any `Number()` casts that assumed a JS number return type. Lessons-2026-04-29 says treat them as strings.
- **GELF log driver on macOS requires Docker Desktop's loopback DNS to resolve `localhost`.** This works on Docker Desktop 4.x. On Linux daemons, `udp://localhost:12201` works because the container's published port is on the host's loopback. If logs don't appear in Kibana, the fallback is `driver: json-file` on the server + a sidecar Filebeat container reading `/var/lib/docker/containers/*/*.log` — document this as a follow-up in the README.
- **Elasticsearch needs `vm.max_map_count >= 262144` on the host kernel.** Docker Desktop sets this by default on Mac/Windows; Linux hosts may need `sysctl -w vm.max_map_count=262144`. README documents this.
- **Telegram user-account session requires an interactive login the first time.** GramJS prompts for the verification code on stdin; this doesn't work cleanly in a non-TTY container start. Documented workaround: run `pnpm tg-login` on the host once to seed `data/session.txt`, then copy into the volume.
- **`prepare: false` on postgres.js disables prepared-statement caching** — slight perf cost (negligible at the QPS this tool sees). The win is that the migrator's per-statement execution doesn't poison the prepared cache with DDL.
- **No Influx in the compose stack.** The server's Influx integration is optional (`INFLUXDB_URL` is `.optional()` in config). Compose leaves those env vars unset and the server skips Influx persistence — matches the existing "non-fatal if missing" boot path. If the user wants Influx too, that's a follow-up.
- **Double volume mount (`tele_data:/data` + `tele_data:/app/data`)** — Docker mounts the same named volume at two paths, which works but is unusual. The cleaner alternative is to set `INSTALLED_APPS_BASE` from an env var rather than `process.cwd()`-relative, but that's a server code change beyond Docker scope. Accept the double mount in v1; consider the env-var fix as a follow-up lesson.
- **Image size**: the multi-stage build ships `node_modules` (entire workspace), which includes deps for shared/server only — but `node:20-alpine + git` is ~150 MB plus ~300 MB of node_modules. Acceptable for local use; future work could `pnpm deploy` only the server's runtime deps into the final stage.
