FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Compile native SQLite/PTY modules if no prebuilt binary is available.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*
ENV HUSKY=0 ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
# npm ci runs postinstall before the remaining source is copied.
COPY scripts/fix-node-pty.js ./scripts/fix-node-pty.js
RUN npm ci --include=dev
COPY . .
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init git openssh-client ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --create-home --shell /bin/bash nodejs \
    && mkdir -p /workspace/cloudcli \
    && chown -R nodejs:nodejs /workspace

ENV NODE_ENV=production SERVER_PORT=3001 HOST=0.0.0.0 \
    DATABASE_PATH=/workspace/cloudcli/database.db
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public

USER nodejs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const r=require('http').get('http://127.0.0.1:'+(process.env.SERVER_PORT||3001)+'/health',s=>{s.resume();process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(5000,()=>{r.destroy();process.exit(1)});"
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "run", "server"]
