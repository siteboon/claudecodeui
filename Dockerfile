FROM node:22-bookworm-slim AS node

# required for node-pty
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3

FROM node AS deps-prod

# install production dependencies
WORKDIR /app
COPY package.json .
COPY scripts/fix-node-pty.js scripts/fix-node-pty.js
RUN npm install --production

FROM deps-prod AS deps

# install development dependencies
WORKDIR /app
RUN npm install --include=dev


FROM node AS builder

WORKDIR /src
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
RUN npm run build


FROM gcr.io/distroless/nodejs22-debian13 AS runner
WORKDIR /app
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/package.json ./package.json
COPY --from=builder /src/server ./server
COPY --from=builder /src/public ./public
COPY --from=builder /src/shared ./shared

EXPOSE 3001

CMD ["server/index.js"]
