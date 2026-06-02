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
