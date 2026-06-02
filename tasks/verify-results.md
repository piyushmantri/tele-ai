# Verify: Dockerize tele monorepo (local Neon stack + Elastic stack)

Date: 2026-06-02
Branch: `kode`
Commit under test: `1e322c4` — "Add Docker setup: local Neon stack + Elastic stack + server/web containers"
Verifier mode: static checks only — `docker compose up` was NOT run (user explicitly deferred).

## Acceptance criteria

### Criterion 1 — Full stack up (13 containers reach `healthy`/running)
**PASS (static portion) — DEFERRED (live boot portion)**

Static verification:
- `docker compose config --services` lists 14 services: `compute1, elasticsearch, filebeat, kibana, logstash, minio, minio_create_buckets, pageserver, safekeeper1, safekeeper2, safekeeper3, server, storage_broker, web`.
- `minio_create_buckets` is a one-shot bootstrap (exits 0 after creating the MinIO bucket) → 13 long-running containers as the acceptance criterion expects.
- `docker compose config --quiet` exits 0 → YAML is valid, all interpolations resolve, image refs parse.
- Healthchecks present on `minio`, `compute1`, `elasticsearch` (compose lines 14/174/190). Server healthcheck is defined in `apps/server/Dockerfile` line 30-31 (`HEALTHCHECK --interval=10s ... curl -fsS http://localhost:3000/api/health`) — compose inherits it, and `web` correctly waits on `server: { condition: service_healthy }` (compose line 257-259).
- `depends_on` chains correct: server→compute1 (healthy), web→server (healthy), logstash/kibana→elasticsearch (healthy), filebeat→logstash (started), minio_create_buckets→minio (healthy), safekeepers/pageserver→minio_create_buckets+storage_broker.

Live boot (`docker compose up -d --build`, verify all 13 healthy within 180s): **DEFERRED to user.**

### Criterion 2 — Migrations applied
**DEFERRED (requires `docker compose up`)**

Static verification:
- `apps/server/src/db/migrations/` contains **26 SQL files** (NOT 27 as the acceptance line states — numbering goes 0001…0027 with `0024_*` skipped). This is a documentation drift in the acceptance criterion, not an implementation defect: every migration in the directory will be applied by `migrate.ts` (which globs `*.sql`).
- `apps/server/Dockerfile:26` copies them to `dist/db/migrations` matching `migrate.ts:8`'s `__dirname + "/migrations"` resolution.

Live verification: `docker compose exec compute1 psql -U cloud_admin -d postgres -c '\dt'` — DEFERRED.

### Criterion 3 — `/api/health` returns 200
**PASS (static) — DEFERRED (live)**

Evidence: `apps/server/src/api/index.ts:57` registers `app.get("/api/health", ...)`. Endpoint is in the PUBLIC_PATHS set at line 28 (no auth required). Dockerfile healthcheck pinned to this path.

### Criterion 4 — Web reverse proxy on `:8080`
**PASS (static) — DEFERRED (live)**

Evidence (`apps/web/nginx.conf`):
- `/api/` → `proxy_pass http://backend` (line 6) where `upstream backend { server server:3000; }` (line 1)
- `/ws` → `proxy_pass http://backend` with `Upgrade`/`Connection: upgrade` headers + `proxy_http_version 1.1` (lines 9-12) → WS upgrade correctly configured
- `/` → `try_files $uri /index.html` (line 13) → SPA fallback
- `client_max_body_size 2m` (line 5)
- Web service publishes `8080:80` (compose line 260-261).

### Criterion 5 — Logs in Kibana with parsed `app.*` fields
**DEFERRED (requires `docker compose up`)**

Static verification:
- `infra/elastic/filebeat.yml`: container input on `/var/lib/docker/containers/*/*.log`, `add_docker_metadata`, `decode_json_fields` with `target: app`, output to `logstash:5044`.
- `infra/elastic/logstash.conf`: beats input on 5044, maps `[app][t]` → `@timestamp`, outputs to `tele-logs-%{+YYYY.MM.dd}` index on `http://elasticsearch:9200`.
- Filebeat correctly bind-mounts `/var/lib/docker/containers` and `/var/run/docker.sock` (compose lines 213-215).

### Criterion 6 — Restart persistence
**PASS (static) — DEFERRED (live)**

Evidence: named volumes declared for `tele_data` (server `/data` + `/app/data` double mount, lines 247-249), plus `pageserver_data`, `safekeeper{1,2,3}_data`, `minio_data` ensure Neon storage persists. `SESSION_FILE: /data/session.txt` (line 246) writes the Telegram session to the named volume.

### Criterion 7 — `down` vs `down -v`
**PASS (by construction)** — all stateful services use named volumes (not bind mounts to host paths), so `down` preserves data and `down -v` wipes it. No verification needed beyond static.

### Criterion 8 — Type-check passes
**PARTIAL PASS — server PASS, web FAIL (pre-existing, NOT introduced by Docker work)**

Server:
```bash
$ cd apps/server && npx tsc -p tsconfig.json --noEmit
exit code: 0
```
No errors. The single change to `apps/server/src/db/index.ts` (adding `neonConfig` import + 3 lines) compiles cleanly.

Web:
```bash
$ cd apps/web && npx tsc -b
… 104 error lines (TS2307 'kodeui' module not found + TS7006 implicit-any on event handlers) …
```
**These errors pre-exist on HEAD~1** (commit `2d1fb8f`, the commit BEFORE the Docker work). Verified by `git checkout HEAD~1 -- apps/web && cd apps/web && npx tsc -b 2>&1 | wc -l` → also `104` lines of identical errors. The Docker commit touched ZERO files under `apps/web/src/`; only `apps/web/Dockerfile` and `apps/web/nginx.conf` were added. So while the criterion as literally written ("exit 0") fails, the Dockerization itself introduced no new TS errors.

### Criterion 9 — Boot-time config validation
**PASS (by construction)** — `config.ts` uses zod and process exits non-zero on parse failure. `.env.docker.example` enumerates `TG_API_ID`, `TG_API_HASH`, `GEMINI_API_KEY`, `DASHBOARD_PASSWORD` as required (line 1 comment: "server will refuse to boot if any of these are missing or empty"). Compose passes them via `${VAR}` interpolation with no fallback default for the secrets.

### Criterion 10 — Driver works unchanged (minimal diff to `db/index.ts`)
**PASS**

```diff
$ git diff HEAD~1 apps/server/src/db/index.ts
-import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
+import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";
 import { config } from "../config.js";
 import { logger } from "../util/logger.js";
 import { incCounter } from "../util/metrics.js";

+// When DATABASE_URL points at a local Neon compute (compose service name),
+// re-route HTTP /sql calls and disable secure-WS. Bypassed for cloud Neon
+// DSNs because NEON_FETCH_ENDPOINT is only set inside docker-compose.
+if (process.env.NEON_FETCH_ENDPOINT) {
+  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
+  neonConfig.useSecureWebSocket = false;
+  neonConfig.poolQueryViaFetch = true;
+}
+
 const _sql = neon(config.DATABASE_URL);
```

Confirmed: ONLY `neonConfig` added to the import + a 3-line env-guarded config block. `neon(config.DATABASE_URL)` call site UNCHANGED. Every `_sql` use, the `query()` wrapper, the `sqlWithRetry` retry logic, all unchanged. `git diff HEAD~1 HEAD --name-only` shows zero `db/repos/*.ts` files modified. Production cloud-Neon DSNs unaffected (env var only set inside docker-compose).

## Step 11 — Live pgcrypto / migrations smoke test
**DEFERRED — requires `docker compose up`**

Per task instruction explicitly: "Mark step 11 (pgcrypto live check) as 'requires docker compose up — deferred to user'".

## Required files inventory

| File | Present | Size |
|---|---|---|
| `docker-compose.yml` | yes | 7932 B |
| `apps/server/Dockerfile` | yes | 1204 B |
| `apps/web/Dockerfile` | yes | 593 B |
| `apps/web/nginx.conf` | yes | 601 B |
| `.env.docker.example` | yes | 412 B |
| `.dockerignore` | yes | 129 B |
| `infra/elastic/filebeat.yml` | yes | 294 B |
| `infra/elastic/logstash.conf` | yes | 249 B |
| `infra/neon/VENDORED_FROM.md` | yes | 1839 B |
| `infra/neon/compute_wrapper/Dockerfile` | yes | 593 B |
| `infra/neon/compute_wrapper/shell/compute.sh` | yes | — |
| `infra/neon/compute_wrapper/var/db/postgres/configs/config.json` | yes | — |
| `infra/neon/compute_wrapper/{private,public}-key.{pem,der}` | yes | — |
| `infra/neon/pageserver_config/identity.toml` | yes | 8 B |
| `infra/neon/pageserver_config/pageserver.toml` | yes | 508 B |

`infra/neon/VENDORED_FROM.md` correctly pins the upstream SHA: `59e393aef35fea56bbbf5dd1feeebfb3c518731d` and includes a re-vendoring recipe.

## Git status
- Working tree: clean (`git status` → "nothing to commit").
- Branch `kode` up to date with `origin/kode` (`git rev-list --left-right --count origin/kode...HEAD` → `0  0`).
- Commit `1e322c4` is pushed.

## Concerns (do not block PASS verdict, but should be flagged to user before `docker compose up`)

1. **`ghcr.io/neondatabase/neon:latest` is a moving tag** — every `docker compose pull` could pull a different compute storage format and corrupt pageserver state. Already documented in the plan's Risks. Suggest pinning to a specific SHA before any production-like use; fine for local dev.
2. **Migration count drift**: acceptance criterion #2 says "27-migration tables"; actual is 26 (`0024_*` skipped in numbering). Not an implementation defect — all 26 files will apply — but the acceptance criterion's literal text won't match. User should know.
3. **Web typecheck has 104 pre-existing TS errors** (`kodeui` module not found + implicit-any event handlers). Unrelated to Docker work but `apps/web/Dockerfile`'s `pnpm --filter @tele/web build` runs `tsc -b && vite build` — meaning **`docker compose up --build` will FAIL at the web build step until the `kodeui` workspace package is resolved.** This is the most likely blocker the user will hit. Plan/execution did not surface this. Recommend resolving `kodeui` (add to `pnpm-workspace.yaml`, install the package, or change tsconfig) BEFORE first `docker compose up`.
4. **`compute1` DATABASE_URL port mismatch with plan text**: plan documentation says `postgres://cloud_admin@compute1:55432/postgres` (port 55432); actual compose uses `:55433` (matching the published port). Compose is internally consistent (`healthcheck` checks `localhost:55433`, ports expose `55433:55433`). Minor doc/code drift in the plan; compose is correct.
5. **No `infra/influx/` cleanup**: pre-existing `infra/influx/` directory remains. Not part of this task's scope but worth noting in case it's stale.

## Overall verdict

**PASS** for all statically-verifiable criteria (1, 3, 4, 6, 7, 9, 10 fully PASS; 2, 5, 11 deferred to live boot as instructed; 8 — server PASS, web fails for pre-existing reasons documented above).

Live `docker compose up -d --build` smoke test is deferred per user instruction. Before that test, the user should address concern #3 (web build will fail until `kodeui` workspace resolves) and concern #1 (consider pinning the Neon image SHA).
