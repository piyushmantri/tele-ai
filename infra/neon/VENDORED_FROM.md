## Vendored Neon docker-compose pieces

Source: https://github.com/neondatabase/neon/tree/main/docker-compose
Pinned commit SHA: `59e393aef35fea56bbbf5dd1feeebfb3c518731d`

Vendored files:
- `compute_wrapper/Dockerfile`
- `compute_wrapper/private-key.pem`
- `compute_wrapper/public-key.pem`
- `compute_wrapper/public-key.der`
- `compute_wrapper/shell/compute.sh`
- `compute_wrapper/var/db/postgres/configs/config.json`
- `pageserver_config/identity.toml`
- `pageserver_config/pageserver.toml`

The wrapper builds on top of `ghcr.io/neondatabase/compute-node-v16:latest`
(see `compute_wrapper/Dockerfile`). The published `compute-node-v16` image is
NOT useful directly — it lacks the entrypoint shell, JWKS keys, and spec
config needed to wire up to the local pageserver/safekeeper cluster.

To re-vendor at a newer SHA, run:
```bash
SHA=<new-sha>
BASE="https://raw.githubusercontent.com/neondatabase/neon/${SHA}/docker-compose"
DEST=infra/neon
curl -fsSL "${BASE}/compute_wrapper/Dockerfile"               -o "${DEST}/compute_wrapper/Dockerfile"
curl -fsSL "${BASE}/compute_wrapper/private-key.pem"          -o "${DEST}/compute_wrapper/private-key.pem"
curl -fsSL "${BASE}/compute_wrapper/public-key.pem"           -o "${DEST}/compute_wrapper/public-key.pem"
curl -fsSL "${BASE}/compute_wrapper/public-key.der"           -o "${DEST}/compute_wrapper/public-key.der"
curl -fsSL "${BASE}/compute_wrapper/shell/compute.sh"         -o "${DEST}/compute_wrapper/shell/compute.sh"
curl -fsSL "${BASE}/compute_wrapper/var/db/postgres/configs/config.json" \
    -o "${DEST}/compute_wrapper/var/db/postgres/configs/config.json"
curl -fsSL "${BASE}/pageserver_config/identity.toml"          -o "${DEST}/pageserver_config/identity.toml"
curl -fsSL "${BASE}/pageserver_config/pageserver.toml"        -o "${DEST}/pageserver_config/pageserver.toml"
```
