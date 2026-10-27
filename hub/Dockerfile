# Build context: the repository root (pnpm workspace with the root package,
# hub/server and hub/web). The root package is needed for the retrieval and
# diagnostics modules that the hub imports.
FROM node:22.22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm run build \
 && pnpm --filter openwiki-hub-server run build \
 && pnpm --filter openwiki-hub-web run build

FROM node:22.22-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    OPENWIKI_HUB_DATA_DIR=/data
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo /repo
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "hub/server/dist/main.js"]
