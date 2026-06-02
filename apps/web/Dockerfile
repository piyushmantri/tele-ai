ARG PNPM_VERSION=10.33.0
FROM node:20-alpine AS build
ARG PNPM_VERSION
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
    rm pnpm-lock.yaml && \
    pnpm install --ignore-scripts
COPY apps/web/ apps/web/
RUN pnpm --filter @tele/shared build && pnpm --filter @tele/web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
