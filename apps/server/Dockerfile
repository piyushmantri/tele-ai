ARG PNPM_VERSION=10.33.0

# ---- build stage
FROM node:20-alpine AS build
ARG PNPM_VERSION
RUN apk add --no-cache git python3 make g++
WORKDIR /app
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
ENV npm_config_strict_ssl=false
RUN npm i -g pnpm@${PNPM_VERSION}
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ packages/
COPY vendor/ vendor/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm config set registry https://registry.npmjs.org/ && \
    pnpm config set registry https://registry.npmjs.org/ && \
    pnpm install --no-frozen-lockfile
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
