FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# =============================================================================
# Production stage
# =============================================================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    tzdata

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.html ./index.html

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

# Create necessary directories with proper permissions
RUN mkdir -p /data /config /home/node/.claude && \
    chown -R node:node /app /data /config /home/node/.claude

# Switch to node user (uid/gid 1000)
USER node

# Environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/data/auth.db \
    CLAUDE_CLI_PATH=claude

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "server/index.js"]
