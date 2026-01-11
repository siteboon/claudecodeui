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

# Install runtime dependencies including bash and curl for CLI installations
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    tzdata \
    bash \
    curl

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

# Install all supported CLIs globally
# 1. Claude Code CLI - Anthropic's official CLI
RUN npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

# 2. Cursor CLI - Install via official method
RUN curl -fsSL https://cursor.com/install | bash

# 3. Codex CLI - OpenAI's Codex CLI
RUN npm install -g @openai/codex && \
    npm cache clean --force

# 4. Taskmaster CLI - AI task orchestration
RUN npm install -g taskmaster-cli && \
    npm cache clean --force

# Create necessary directories with proper permissions for all CLIs
RUN mkdir -p /data /config /init-scripts /home/node/.claude /home/node/.cursor /home/node/.openai /home/node/.taskmaster && \
    chown -R node:node /app /data /config /init-scripts /home/node/.claude /home/node/.cursor /home/node/.openai /home/node/.taskmaster

# Copy entrypoint script
COPY --chown=node:node docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Switch to node user (uid/gid 1000)
USER node

# Environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/data/auth.db \
    CLAUDE_CLI_PATH=claude

# Expose port
EXPOSE 3001

# Start server using entrypoint script
CMD ["/app/docker-entrypoint.sh"]
