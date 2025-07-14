# Build stage
FROM node:20-alpine AS builder

# Install python and build dependencies for native modules
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies for building
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:20-alpine

# Install python and build dependencies for native modules (required for better-sqlite3, bcrypt, etc.)
# Also install curl for downloading Claude CLI
RUN apk add --no-cache python3 make g++ git curl bash

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server files
COPY server ./server
COPY public ./public
COPY index.html ./index.html

# Copy .env file if it exists (for server/index.js to read)
# Note: Environment variables are also injected via docker-compose.yml
COPY .env* ./

# Install Claude Code CLI as a dependency
RUN npm install @anthropic-ai/claude-code

# Create symlink for claude command to make it available globally
RUN ln -s /app/node_modules/.bin/claude /usr/local/bin/claude

# Create Claude directory structure and set permissions
RUN mkdir -p /root/.claude/projects /root/.claude/logs /root/.config/claude && \
    chmod -R 755 /root/.claude /root/.config

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose the server port
EXPOSE 3000

# Use entrypoint script
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]