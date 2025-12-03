# Build stage
FROM node:20-bookworm AS builder

# Install build dependencies for native modules (node-pty, better-sqlite3, bcrypt)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:20-bookworm-slim

# Install runtime dependencies for native modules and git (needed for clone/deploy)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Install Claude Code CLI globally so 'claude' command is available
RUN npm install -g @anthropic-ai/claude-code

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server files
COPY --from=builder /app/server ./server

# Copy public files if they exist
COPY --from=builder /app/public ./public

# Create directories for data persistence
RUN mkdir -p /app/data /root/.claude /root/coolify-apps

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the server
CMD ["node", "server/index.js"]
