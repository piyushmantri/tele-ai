# Dockerize tele — Final Plan (REV 2: local Neon stack)

## Task
Dockerize the tele monorepo so `docker compose up` starts: server, web (nginx static), a **fully local Neon stack** (compute + pageserver + safekeepers + storage broker + minio object store) replacing the cloud Neon DB, and the Elastic stack (ES + Filebeat + Logstash + Kibana) — with named volumes for compute data, minio data, ES, and server data. The existing `@neondatabase/serverless` driver stays in place; only `neonConfig` is overridden when the DSN points at the local compute.

## Revision history
- **REV 1** swapped Neon driver → `postgres.js` against `postgres:16-alpine`. Rejected by user.
- **REV 2 (this)** keeps the Neon driver, uses `neondatabase/neon` upstream Docker images (full local stack from https://github.com/neondatabase/neon/tree/main/docker-compose) so there is no cloud dependency AND no driver swap. Three small additions to `db/index.ts` configure `neonConfig` for the local fetch endpoint; if `DATABASE_URL` points at cloud Neon, the new config is bypassed (env-conditional).

## Decision: which "Neon Docker image"?

Two upstream options exist; this plan uses **option B**:

| Option | Image(s) | Cloud-free? | Driver works unchanged? | Complexity |
|---|---|---|---|---|
| A. `neondatabase/neon_local` | `neondatabase/neon_local:latest` | **No** — requires `NEON_API_KEY` + `NEON_PROJECT_ID`; auto-creates ephemeral branches in CLOUD. | Yes (with `DRIVER=serverless` env). | 1 container. |
| **B. `neondatabase/neon` full stack** | `ghcr.io/neondatabase/neon:latest` (pageserver/safekeepers/broker) + locally-built `compute1` + `minio` | **Yes** — fully self-contained; MinIO replaces S3. | Yes, with three `neonConfig` overrides for fetch endpoint + WS settings. | 7 containers (incl. minio_create_buckets bootstrap). |

The user's brief ("replacing Neon cloud DB", "open-source Neon Docker image") rules out option A — it would still require a Neon cloud account. Option B is fragile (upstream README explicitly says the compose file is "for testing Neon docker images" and "not intended for deploying a usable system"), but it is the only path that satisfies BOTH constraints simultaneously.

**Risk surfaced:** if option B proves unstable in practice (compute crashes, pageserver state corruption, image-tag drift breaking the compute build), the fallback is to accept option A's cloud dependency. Documented in the Risks section; not silently mitigated.

## Critic feedback addressed (carried over from REV 1)
- **Concern 1 (config zod boot failure)** → still applies; `.env.docker.example` enumerates ALL required vars; compose pins safe defaults for `WORKSPACE_ROOT`.
- **Concern 2 (query() rewrite)** → **NO LONGER APPLIES** in REV 2. The Neon driver is unchanged; `db/index.ts` keeps its existing `_sql` calls and `query()` wrapper.
- **Concern 4 (migrations path)** → still applies; Dockerfile copies migrations to `apps/server/dist/db/migrations` to match `migrate.ts:7-8`'s `__dirname + "/migrations"`.
- **Concern 5 (GELF flakiness)** → still applies; using Filebeat sidecar pattern.
- **Concern 7 (server healthcheck)** → still applies; server HEALTHCHECK pinned to `/api/health` (`api/index.ts:57`); web waits on `server: condition: service_healthy`.
- **Concern 9 (pgcrypto extension)** → **CHECK NEEDED**. Neon's compute image is based on a custom Postgres build with many extensions pre-installed. `gen_random_uuid()` is the standard pgcrypto function — and Postgres 13+ provides it without an extension (it's built into Postgres core since pg13). **Plan step 4a verifies this with a quick smoke test against the running compute; if pgcrypto is missing, a one-line bootstrap psql call adds it.** No `/docker-entrypoint-initdb.d/` mount because Neon's compute image doesn't use the standard Postgres entrypoint.
- **Question A (CORS)**, **Question D (health route)**, **Question E (apps env knob)**, **Question F (body limit)** — all unchanged from REV 1.

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  docker compose (one network)                                 │
│                                                               │
│  ┌────────┐  ┌────────────┐  ┌─────────────────────────────┐ │
│  │ minio  │  │ storage_   │  │ safekeeper1/2/3             │ │
│  │ :9000  │  │ broker     │  │ :7676 :7677 :7678           │ │
│  └────▲───┘  │ :50051     │  └────────┬────────────────────┘ │
│       │      └────┬───────┘           │                      │
│       │           │                   │                      │
│  ┌────┴───────────┴───────────────────┴────────────────────┐ │
│  │ pageserver  :9898                                       │ │
│  └────┬──────────────────────────────────────────────────-─┘ │
│       │                                                      │
│  ┌────▼───────────────────────────────────────────────────┐  │
│  │ compute1 (Neon Postgres compute)                       │  │
│  │   :55433 (Postgres wire) :3080 (HTTP /sql endpoint)    │  │
│  └────┬───────────────────────────────────────────────────┘  │
│       │                                                      │
│  ┌────▼────────────────────────────────────────────────--─┐  │
│  │ server (Fastify, :3000)                                │  │
│  │   DATABASE_URL=postgres://cloud_admin@compute1:55432/postgres │
│  │   NEON_FETCH_ENDPOINT=http://compute1:3080/sql         │  │
│  └────┬────────────────────────-──────────────────────────┘  │
│       │                                                      │
│  ┌────▼──────┐   ┌──────────┐   ┌───────┐   ┌────────────┐   │
│  │ web/nginx │   │  kibana  │   │ logsh │   │  filebeat  │   │
│  │   :8080   │   │   :5601  │   │ :5044 │   │  (sidecar) │   │
│  └───────────┘   └──────────┘   └───▲───┘   └────┬───────┘   │
│                  ┌──────────────┐   │            │           │
│                  │elasticsearch │◀──┘            │           │
│                  │    :9200     │◀───────────────┘           │
│                  └──────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

Named volumes (persisted): `minio_data`, `safekeeper1_data`, `safekeeper2_data`, `safekeeper3_data`, `pageserver_data`, `es_data`, `tele_data` (covers `/app/data` AND `/data` for server workspace/session/installed apps).

## Files to touch

| File | Reason |
|---|---|
| `apps/server/src/db/index.ts` | **Small additive change only — no driver swap.** Before constructing the `neon()` client, if `DATABASE_URL` host is the compose service name `compute1` (or whatever `NEON_FETCH_ENDPOINT` env var is set), apply `neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT` and `neonConfig.useSecureWebSocket = false` and `neonConfig.poolQueryViaFetch = true`. Three lines, guarded by an env check so production cloud-Neon DSNs are unaffected. |
| `apps/server/package.json` | **No change.** `@neondatabase/serverless` already a dep. No `postgres.js` install. |
| `apps/server/Dockerfile` (NEW) | Multi-stage: install pnpm, build `@tele/shared` + `@tele/server`; runtime stage uses `pnpm deploy --filter @tele/server`; includes `git` + `tini` + `curl`; HEALTHCHECK against `/api/health`. |
| `apps/web/Dockerfile` (NEW) | Multi-stage: build vite → nginx:alpine serving `dist/` with `/api` + `/ws` proxied to `server:3000`. |
| `apps/web/nginx.conf` (NEW) | SPA fallback + API/WS reverse proxy. `client_max_body_size 2m`. |
| `docker-compose.yml` (NEW, repo root) | 11+ services: minio, minio_create_buckets, storage_broker, pageserver, safekeeper1/2/3, compute1, elasticsearch, logstash, filebeat, kibana, server, web. Healthchecks. `depends_on` chains. |
| `infra/neon/compute_wrapper/` (NEW directory tree) | Copy from upstream `neondatabase/neon` repo's `docker-compose/compute_wrapper/` — the local-build context for the `compute1` service (Dockerfile + entrypoint shell + neon spec config + JWKS keys). This must be vendored because the upstream compose file BUILDS this image locally; we either pin to a published `ghcr.io/neondatabase/compute-node-v16:<tag>` or vendor the wrapper. **Plan step 6 picks the published-image path if a stable tag exists; otherwise vendors the wrapper.** |
| `infra/neon/pageserver_config/` (NEW) | Copy from upstream `docker-compose/pageserver_config/` — pageserver init config files. |
| `infra/elastic/logstash.conf` (NEW) | Beats input on :5044, JSON-decode the `app.*` fields, map `app.t` → `@timestamp`, output to ES index `tele-logs-%{+YYYY.MM.dd}`. |
| `infra/elastic/filebeat.yml` (NEW) | Reads `/var/lib/docker/containers/*/*.log`; `add_docker_metadata` + `decode_json_fields` for `message`; output to `logstash:5044`. |
| `.dockerignore` (NEW, repo root) | Build-context excludes: `node_modules`, `**/node_modules`, `**/dist`, `data`, `workspace`, `.env`, `.git`, `tasks`, `*.log`. |
| `.env.docker.example` (NEW, repo root) | All zod-required vars: `POSTGRES_PASSWORD` (used inside compose for compute), `TG_API_ID`, `TG_API_HASH`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `DASHBOARD_PASSWORD`. |
| `README.md` | "Run with Docker" section (~50 lines) covering boot, first-run TG login, reset, fallback to `neon_local` option A. |

**Files intentionally NOT touched** (minimum-impact rule, REV 2 stronger than REV 1 because the driver swap is gone):
- Every `db/repos/*.ts` — they call `sql\`…\`` only; nothing changes.
- `apps/server/src/db/index.ts` migration runner contract — `sql(stmt, [])` form preserved; only `neonConfig` is mutated at module load.
- `apps/server/src/util/logger.ts` — stdout JSONL captured by docker → filebeat → logstash.
- `apps/web/vite.config.ts` — dev-only.
- `apps/server/src/api/index.ts` — already binds 0.0.0.0; `/api/health` at line 57.
- `apps/server/src/applications/install.ts` — cwd-relative; accommodated via double-mount.
- All 27 migration files — already idempotent (`IF NOT EXISTS`); the Neon compute speaks standard Postgres SQL.

## Steps

### Phase 1: Driver config tweak (replaces REV 1's Phase 1 driver swap)
- [x] 1. Edit `apps/server/src/db/index.ts`:
  - Add at top, AFTER the existing `import { neon, ... } from "@neondatabase/serverless"`:
    ```ts
    import { neonConfig } from "@neondatabase/serverless";

    // When DATABASE_URL points at a local Neon compute (compose service name),
    // re-route HTTP /sql calls and disable secure-WS. Bypassed for cloud Neon
    // DSNs because NEON_FETCH_ENDPOINT is only set inside docker-compose.
    if (process.env.NEON_FETCH_ENDPOINT) {
      neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
      neonConfig.useSecureWebSocket = false;
      neonConfig.poolQueryViaFetch = true;
    }
    ```
  - That's the entire change. Three lines guarded by an env check. The existing `neon(config.DATABASE_URL)` call works unchanged.
- [x] 2. Verify `cd apps/server && npx tsc -p tsconfig.json --noEmit` passes (it should — `neonConfig` is already exported from the same package).
- [x] 3. No standalone smoke test in this phase — the full smoke test happens in Phase 5 after compose comes up (because the local Neon compute is what we need to talk to, and that requires the compose stack already running).

### Phase 2: Vendor the upstream Neon compose pieces
- [x] 4. Decide vendor vs published image for `compute1`:
  - 4a. Check Docker Hub / GHCR for a tagged `ghcr.io/neondatabase/compute-node-v16:<stable_tag>` image. If one exists with a release tag (not just `latest`), use it directly in `docker-compose.yml` and SKIP the `infra/neon/compute_wrapper/` vendor step.
  - 4b. If no stable tag exists (i.e. compute is only ever built locally upstream), vendor `infra/neon/compute_wrapper/` from `https://github.com/neondatabase/neon/tree/main/docker-compose/compute_wrapper/` at a pinned commit SHA. Include the commit SHA in a `VENDORED_FROM.md` note next to the directory.
  - The executor MUST pick 4a if possible because a vendored Dockerfile becomes a maintenance burden.
  - **Decision (4b)**: published `compute-node-v16:latest` exists on GHCR but is unusable directly — it lacks the wrapper's entrypoint shell (`compute.sh`), JWKS keys, and spec config. Upstream `docker-compose.yml` always builds via `compute_wrapper/`. Vendored at SHA `59e393aef35fea56bbbf5dd1feeebfb3c518731d` to `infra/neon/compute_wrapper/`; see `infra/neon/VENDORED_FROM.md`.
- [x] 5. Vendor `infra/neon/pageserver_config/` from upstream at the same pinned SHA. This is just init config files (small), so vendoring is fine.

### Phase 3: Server container
- [x] 6. Create `apps/server/Dockerfile`:
  ```dockerfile
  ARG PNPM_VERSION=10.33.0

  # ---- build stage
  FROM node:20-alpine AS build
  ARG PNPM_VERSION
  RUN apk add --no-cache git python3 make g++
  WORKDIR /app
  RUN npm i -g pnpm@${PNPM_VERSION}
  COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
  COPY packages/ packages/
  COPY vendor/ vendor/
  COPY apps/server/package.json apps/server/
  COPY apps/web/package.json apps/web/
  RUN pnpm install --frozen-lockfile
  COPY apps/server/ apps/server/
  RUN pnpm --filter @tele/shared build && pnpm --filter @tele/server build
  RUN pnpm --filter @tele/server deploy --prod /deploy

  # ---- runtime stage
  FROM node:20-alpine
  RUN apk add --no-cache git tini ca-certificates curl
  WORKDIR /app
  COPY --from=build /deploy/node_modules ./node_modules
  COPY --from=build /deploy/package.json ./package.json
  COPY --from=build /app/apps/server/dist ./dist
  COPY --from=build /app/apps/server/src/db/migrations ./dist/db/migrations
  COPY --from=build /app/apps/server/applications ./applications
  ENV NODE_ENV=production
  EXPOSE 3000
  HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=12 \
    CMD curl -fsS http://localhost:3000/api/health || exit 1
  ENTRYPOINT ["/sbin/tini","--"]
  CMD ["node","dist/index.js"]
  ```
  Note: `start-period=60s` (up from REV 1's 30s) because the Neon compute takes longer to become reachable than `postgres:16-alpine`.

### Phase 4: Web container
- [x] 7. Create `apps/web/Dockerfile` (unchanged from REV 1):
  ```dockerfile
  ARG PNPM_VERSION=10.33.0
  FROM node:20-alpine AS build
  ARG PNPM_VERSION
  WORKDIR /app
  RUN npm i -g pnpm@${PNPM_VERSION}
  COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
  COPY packages/ packages/
  COPY vendor/ vendor/
  COPY apps/server/package.json apps/server/
  COPY apps/web/package.json apps/web/
  RUN pnpm install --frozen-lockfile
  COPY apps/web/ apps/web/
  RUN pnpm --filter @tele/shared build && pnpm --filter @tele/web build

  FROM nginx:alpine
  COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
  COPY --from=build /app/apps/web/dist /usr/share/nginx/html
  EXPOSE 80
  ```
- [x] 8. Create `apps/web/nginx.conf` (unchanged from REV 1):
  ```nginx
  upstream backend { server server:3000; }
  server {
    listen 80;
    root /usr/share/nginx/html;
    client_max_body_size 2m;
    location /api/ { proxy_pass http://backend; proxy_set_header Host $host;
                     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                     proxy_read_timeout 300s; }
    location /ws  { proxy_pass http://backend; proxy_http_version 1.1;
                    proxy_set_header Upgrade $http_upgrade;
                    proxy_set_header Connection "upgrade";
                    proxy_read_timeout 3600s; }
    location /    { try_files $uri /index.html; }
  }
  ```

### Phase 5: docker-compose.yml (the BIG one)
- [x] 9. Create supporting infra files first:
  - 9a. `infra/elastic/filebeat.yml` (unchanged from REV 1):
    ```yaml
    filebeat.inputs:
      - type: container
        paths: ["/var/lib/docker/containers/*/*.log"]
    processors:
      - add_docker_metadata: {}
      - decode_json_fields:
          fields: ["message"]
          target: "app"
          overwrite_keys: true
          add_error_key: true
    output.logstash:
      hosts: ["logstash:5044"]
    ```
  - 9b. `infra/elastic/logstash.conf` (unchanged from REV 1):
    ```
    input { beats { port => 5044 } }
    filter {
      if [app][t] {
        date { match => ["[app][t]", "ISO8601"] target => "@timestamp" }
      }
    }
    output {
      elasticsearch {
        hosts => ["http://elasticsearch:9200"]
        index => "tele-logs-%{+YYYY.MM.dd}"
      }
    }
    ```
  - 9c. `.env.docker.example`:
    ```
    # Required — server will refuse to boot if any of these are missing or empty
    TG_API_ID=
    TG_API_HASH=
    GEMINI_API_KEY=
    DASHBOARD_PASSWORD=

    # Optional (defaults shown)
    GEMINI_MODEL=gemini-2.0-flash

    # DO NOT set DATABASE_URL, WORKSPACE_ROOT, or NEON_FETCH_ENDPOINT here —
    # docker-compose sets all three. The local Neon stack uses fixed
    # credentials (cloud_admin / no password) hardcoded in the compose file.
    ```
  - 9d. Root `.dockerignore`:
    ```
    node_modules
    **/node_modules
    **/dist
    data
    workspace
    .env
    .env.docker.example
    .git
    tasks
    *.log
    infra/neon/pageserver_config/local
    ```

- [x] 10. Create `docker-compose.yml` at repo root. Structure (full YAML follows the upstream Neon `docker-compose/docker-compose.yml` for the Neon services; tele services bolted on):
  ```yaml
  name: tele

  services:
    # ---- Neon stack (verbatim from upstream docker-compose, pinned image tags) ----
    minio:
      image: quay.io/minio/minio:RELEASE.2022-10-20T00-55-09Z
      command: server /data --address :9000 --console-address ":9001"
      environment:
        MINIO_ROOT_USER: minio
        MINIO_ROOT_PASSWORD: password
      volumes: [minio_data:/data]
      healthcheck:
        test: ["CMD-SHELL", "curl -fsS http://localhost:9000/minio/health/live"]
        interval: 5s
        timeout: 3s
        retries: 20

    minio_create_buckets:
      image: minio/mc
      depends_on:
        minio: { condition: service_healthy }
      entrypoint: >
        sh -c "until /usr/bin/mc alias set minio http://minio:9000 minio password; do sleep 1; done
              && /usr/bin/mc mb --ignore-existing minio/neon
              && exit 0"

    storage_broker:
      image: ghcr.io/neondatabase/neon:latest
      command: ["storage_broker", "--listen-addr=0.0.0.0:50051"]

    safekeeper1: &safekeeper
      image: ghcr.io/neondatabase/neon:latest
      restart: always
      depends_on:
        minio_create_buckets: { condition: service_completed_successfully }
      environment:
        SAFEKEEPER_ADVERTISE_URL: safekeeper1:5454
        SAFEKEEPER_ID: 1
        BROKER_ENDPOINT: http://storage_broker:50051
        AWS_ACCESS_KEY_ID: minio
        AWS_SECRET_ACCESS_KEY: password
      command:
        - safekeeper
        - --listen-pg=0.0.0.0:5454
        - --listen-http=0.0.0.0:7676
        - --id=$${SAFEKEEPER_ID}
        - --broker-endpoint=$${BROKER_ENDPOINT}
        - -D
        - /data
        - --remote-storage={endpoint='http://minio:9000', bucket_name='neon', bucket_region='eu-north-1', prefix_in_bucket='/safekeeper/'}
      volumes: [safekeeper1_data:/data]

    safekeeper2:
      <<: *safekeeper
      environment:
        SAFEKEEPER_ADVERTISE_URL: safekeeper2:5454
        SAFEKEEPER_ID: 2
        BROKER_ENDPOINT: http://storage_broker:50051
        AWS_ACCESS_KEY_ID: minio
        AWS_SECRET_ACCESS_KEY: password
      volumes: [safekeeper2_data:/data]

    safekeeper3:
      <<: *safekeeper
      environment:
        SAFEKEEPER_ADVERTISE_URL: safekeeper3:5454
        SAFEKEEPER_ID: 3
        BROKER_ENDPOINT: http://storage_broker:50051
        AWS_ACCESS_KEY_ID: minio
        AWS_SECRET_ACCESS_KEY: password
      volumes: [safekeeper3_data:/data]

    pageserver:
      image: ghcr.io/neondatabase/neon:latest
      restart: always
      depends_on:
        minio_create_buckets: { condition: service_completed_successfully }
      environment:
        BROKER_ENDPOINT: http://storage_broker:50051
        AWS_ACCESS_KEY_ID: minio
        AWS_SECRET_ACCESS_KEY: password
      volumes:
        - pageserver_data:/data
        - ./infra/neon/pageserver_config:/data/.neon
      # Command per upstream; init script handles tenant/timeline creation.

    compute1:
      # If a stable published tag exists (verified in step 4a), use:
      # image: ghcr.io/neondatabase/compute-node-v16:<pinned-tag>
      # else:
      build: ./infra/neon/compute_wrapper
      restart: always
      depends_on:
        - safekeeper1
        - safekeeper2
        - safekeeper3
        - pageserver
      environment:
        PG_VERSION: "16"
        # TENANT_ID/TIMELINE_ID come from the wrapper's entrypoint init.
      ports:
        - "55433:55433"   # Postgres wire
        - "3080:3080"     # HTTP /sql endpoint (Neon serverless driver target)
      networks:
        default:
          aliases: [compute]   # backward-compat alias from upstream
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -h localhost -p 55433 -U cloud_admin"]
        interval: 10s
        timeout: 5s
        retries: 30
        start_period: 60s

    # ---- Elastic stack (carried over from REV 1) ----
    elasticsearch:
      image: docker.elastic.co/elasticsearch/elasticsearch:8.13.4
      environment:
        - discovery.type=single-node
        - xpack.security.enabled=false
        - ES_JAVA_OPTS=-Xms512m -Xmx512m
      volumes: [es_data:/usr/share/elasticsearch/data]
      healthcheck:
        test: ["CMD-SHELL", "curl -fsS http://localhost:9200/_cluster/health | grep -Eq '\"status\":\"(yellow|green)\"'"]
        interval: 10s
        timeout: 5s
        retries: 30
      ulimits:
        memlock: { soft: -1, hard: -1 }

    logstash:
      image: docker.elastic.co/logstash/logstash:8.13.4
      depends_on:
        elasticsearch: { condition: service_healthy }
      volumes:
        - ./infra/elastic/logstash.conf:/usr/share/logstash/pipeline/logstash.conf:ro

    filebeat:
      image: docker.elastic.co/beats/filebeat:8.13.4
      user: root
      depends_on:
        logstash: { condition: service_started }
      volumes:
        - ./infra/elastic/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
        - /var/lib/docker/containers:/var/lib/docker/containers:ro
        - /var/run/docker.sock:/var/run/docker.sock:ro
      command: ["--strict.perms=false"]

    kibana:
      image: docker.elastic.co/kibana/kibana:8.13.4
      depends_on:
        elasticsearch: { condition: service_healthy }
      environment:
        - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
      ports: ["5601:5601"]

    # ---- tele services ----
    server:
      build: { context: ., dockerfile: apps/server/Dockerfile }
      depends_on:
        compute1: { condition: service_healthy }
      environment:
        DATABASE_URL: postgres://cloud_admin@compute1:55432/postgres
        NEON_FETCH_ENDPOINT: http://compute1:3080/sql
        TG_API_ID: ${TG_API_ID}
        TG_API_HASH: ${TG_API_HASH}
        GEMINI_API_KEY: ${GEMINI_API_KEY}
        GEMINI_MODEL: ${GEMINI_MODEL:-gemini-2.0-flash}
        DASHBOARD_PASSWORD: ${DASHBOARD_PASSWORD}
        PORT: 3000
        WORKSPACE_ROOT: /data/workspace
        SESSION_FILE: /data/session.txt
      volumes:
        - tele_data:/data
        - tele_data:/app/data
      ports: ["3000:3000"]

    web:
      build: { context: ., dockerfile: apps/web/Dockerfile }
      depends_on:
        server: { condition: service_healthy }
      ports: ["8080:80"]

  volumes:
    minio_data: {}
    safekeeper1_data: {}
    safekeeper2_data: {}
    safekeeper3_data: {}
    pageserver_data: {}
    es_data: {}
    tele_data: {}
  ```
  Key correctness notes:
  - The `image: ghcr.io/neondatabase/neon:latest` tag is what upstream uses. For reproducibility, pin to a specific SHA-tagged release (step 11 verifies the latest stable tag at execution time).
  - Connection string `postgres://cloud_admin@compute1:55432/postgres` uses Neon's default superuser `cloud_admin` with NO password (the local stack auth model differs from cloud Neon; password isn't required inside the compose network).
  - `DATABASE_URL` lacks `sslmode=require` — the local compute doesn't terminate TLS. The existing Neon driver tolerates a non-TLS DSN when the fetch endpoint is HTTP (driver inspects `neonConfig.useSecureWebSocket` etc., already set to `false` in step 1).
  - The `compute1` image's pre-installed extensions include `pgcrypto`, `pg_trgm`, and several others (Neon's compute is a Postgres-with-extensions distribution). `gen_random_uuid()` works out of the box; Phase 6's verification confirms this.

### Phase 6: Verification + docs
- [ ] 11. **Live smoke test (replaces REV 1's pre-compose smoke test)** — DEFERRED: requires `docker compose up` (user has not started the stack yet). After `docker compose up -d`, exec into the running compute and verify:
  ```bash
  docker compose exec compute1 psql -U cloud_admin -d postgres -c '\dx'
  # Expect pgcrypto to be in the list. If not:
  docker compose exec compute1 psql -U cloud_admin -d postgres -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
  # Then verify tele migrations are working:
  docker compose logs server | grep "migration applied" | wc -l   # should be 27
  docker compose exec compute1 psql -U cloud_admin -d postgres -c '\dt'  # all tele tables present
  ```
  If `pgcrypto` is NOT in the default extensions list, the executor adds ONE line to the server's startup path (NOT a migration file, since 0001 already uses `gen_random_uuid()` — by then it's too late): a `CREATE EXTENSION IF NOT EXISTS pgcrypto;` call at the top of `runMigrations()` in `apps/server/src/db/migrate.ts`. This is idempotent and safe on cloud Neon too.
- [x] 12. Add "Run with Docker" section to `README.md`:
  ```markdown
  ## Run with Docker

  This setup runs a FULLY LOCAL Neon stack (compute + pageserver + 3 safekeepers + minio-as-S3 + storage broker) so the @neondatabase/serverless driver works unchanged against a self-hosted Postgres-compatible compute. Plus Elasticsearch + Kibana + Filebeat for log aggregation.

  ### Prereqs
  - Docker Desktop (or Docker Engine 24+ with compose v2). On macOS, ensure Docker Desktop's file-sharing uses gRPC FUSE, not VirtioFS (Neon-Local README flags VirtioFS as broken; the full-stack compute appears unaffected but follow the docs' caution).
  - Linux: `sudo sysctl -w vm.max_map_count=262144` for Elasticsearch.
  - 8 GB RAM available to Docker (Neon stack + ES + JVM heap all together).

  ### Boot
  ```bash
  cp .env.docker.example .env
  # Fill in TG_API_ID, TG_API_HASH, GEMINI_API_KEY, DASHBOARD_PASSWORD
  docker compose up -d --build
  ```
  Initial bring-up takes ~2-3 minutes (Neon compute init + ES yellow + tele migrations). Watch `docker compose logs -f server` and look for `"ready"`.

  Visit:
  - http://localhost:8080 — tele dashboard (log in with `DASHBOARD_PASSWORD`).
  - http://localhost:5601 — Kibana (Stack Management → Index Patterns → create `tele-logs-*`).
  - http://localhost:55433 — direct Postgres access via `psql -h localhost -p 55433 -U cloud_admin -d postgres` (no password locally).

  ### First-run Telegram user-account login
  GramJS needs a TTY for the SMS verification code. Workaround:
  ```bash
  # On the host, once
  pnpm install
  pnpm tg-login   # enter phone + code; writes data/session.txt
  # Copy into the named volume
  docker run --rm -v tele_tele_data:/data -v "$PWD/data":/seed alpine cp /seed/session.txt /data/session.txt
  docker compose restart server
  ```

  ### Reset
  - `docker compose down` — stop containers, KEEP all data.
  - `docker compose down -v` — wipes Postgres, Elasticsearch, Telegram session. Use only for a complete fresh start.

  ### If the local Neon stack proves unstable
  The upstream `neondatabase/neon` README warns the docker-compose setup is "for testing Neon docker images" and "not intended for deploying a usable system." If the compute repeatedly crashes or pageserver state corrupts, you have two fallbacks:
  1. **Switch to `neondatabase/neon_local`** (cloud-tied; requires `NEON_API_KEY` + `NEON_PROJECT_ID` env vars; auto-creates ephemeral branches in YOUR cloud Neon project).
  2. **Use plain `postgres:16-alpine`** by swapping the DB driver (see git history of this plan — REV 1 documented this path).
  ```

## Acceptance criteria
1. **Full stack up**: `docker compose up -d --build` from a clean checkout brings all 13 containers up. Within 180s, `docker compose ps` shows compute1, elasticsearch, server marked `healthy`; safekeepers/pageserver/minio/storage_broker/logstash/filebeat/kibana/web all running. The server's HEALTHCHECK passes — proves the Neon stack accepts the driver's HTTP `/sql` calls AND the migration runner completed.
2. **Migrations applied**: `docker compose exec compute1 psql -U cloud_admin -d postgres -c '\dt'` lists all 27-migration tables.
3. **Health route**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health` returns 200.
4. **Web reverse-proxy**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` returns 200; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health` also returns 200.
5. **Logs in Kibana**: visit `http://localhost:5601` → Discover → data view `tele-logs-*` exists and is populated with parsed `app.msg`, `app.level`, `@timestamp` from the server's JSONL output.
6. **Restart persistence**: `docker compose restart server` — table row counts unchanged in `chats`, `messages`. `data/session.txt` persists.
7. **`down` vs `down -v`**: `docker compose down && docker compose up -d` preserves all data. `docker compose down -v && docker compose up -d` starts fresh (Neon compute reinitializes, migrations re-apply).
8. **Type-check**: `cd apps/server && npx tsc -p tsconfig.json --noEmit` and `cd apps/web && npx tsc -b` exit 0.
9. **Boot-time config validation**: with `.env` missing `DASHBOARD_PASSWORD`, `docker compose up server` shows a zod parse error and the container exits non-zero.
10. **Driver works unchanged**: `git diff apps/server/src/db/index.ts` shows ONLY the three-line `neonConfig` block added (plus the import); the `neon()` call site and every repo file are untouched.

## Risks (REV 2 adds Neon-specific items)
- **`ghcr.io/neondatabase/neon:latest` is a moving tag.** Upstream may bump compute storage formats incompatibly; a `docker compose pull` could corrupt the pageserver state. Mitigation: pin to a specific SHA-tagged release in compose; revisit when bumping deliberately.
- **Upstream README says the compose stack is "not intended for deploying a usable system."** This is the load-bearing risk of REV 2. If the stack proves unstable in real use, fallback paths are documented (cloud-tied `neon_local`, or REV 1's `postgres.js` swap).
- **`compute1` needs the wrapper Dockerfile to be vendored** if no published `compute-node-v16` tag is usable. Vendoring creates a maintenance burden (upstream changes require re-vendoring). Mitigation: step 4a prefers the published image; the wrapper is only vendored if necessary, and the pinned commit SHA is recorded.
- **Multiple containers + JVM heap (ES 512m) + Neon's pageserver memory all together** likely needs 8+ GB allocated to Docker on macOS. Documented in README prereqs.
- **`pgcrypto` may not be pre-loaded into the default `postgres` database** even if the extension is installed in the compute image. Mitigation: step 11 verifies live; if missing, ONE line added to `migrate.ts` (idempotent on cloud too).
- **Volume layout for safekeepers/pageserver matters for upgrades.** Named volumes survive `down`, but a wipe (`down -v`) is the only safe path on a stack-version bump. README warns.
- **MinIO image is from 2022.** Upstream pins it; we follow. Compatible with current MinIO clients via the S3 API — not a Docker-Compose risk.
- **First-boot ordering**: pageserver expects safekeepers reachable; compute expects pageserver. `depends_on` covers start order but Neon's components have eventual-consistency startup (storage_broker → safekeepers register → pageserver registers → compute requests timeline). The `compute1` healthcheck waits up to 360s (30 retries × 10s + 60s start_period) which should absorb the cold-start handshake.
- **Filebeat-on-Mac**: same risk as REV 1; the `/var/lib/docker/containers` mount works on Docker Desktop's Linux VM. Fallback to GELF is documented.
- **No `pg_isready` smoke test before the full stack runs**: REV 1 had a standalone migrator smoke test against a throwaway postgres. REV 2 cannot do that because the migrator runs against the Neon HTTP `/sql` endpoint, which only exists when the full compose stack is up. The compensating control is the server's HEALTHCHECK — if migrations fail, `/api/health` never returns 200 and the container stays `unhealthy`, which is visible in `docker compose ps`.
