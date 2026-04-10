FROM node:20-alpine AS builder

WORKDIR /app

# Required for native Node modules (node-pty, sqlite, etc.) when prebuilds are unavailable
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY scripts ./scripts
RUN npm ci

COPY . .

# Build-time base path for Vite assets and router base
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

RUN npm run build
RUN npm prune --omit=dev


FROM node:20-alpine AS runtime

WORKDIR /app

# Runtime libc compatibility for some native modules on Alpine
RUN apk add --no-cache libstdc++

COPY --fnpm i @divyanshi4635/claude-code-uirom=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Runtime path prefix for Express/WebSocket mounting
ENV BASE_PATH=/
ENV SERVER_PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "server/index.js"]