# Multi-stage Dockerfile for Claude Code UI
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 python3-dev py3-setuptools make g++ bash

# Copy package files
COPY package*.json ./
COPY vite.config.js ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY index.html ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy frontend source
COPY src/ ./src/
COPY public/ ./public/

# Build frontend
RUN npm run build

# Stage 2: Production environment with all dependencies
FROM node:20-alpine AS production

# Install system dependencies
RUN apk update && apk add --no-cache \
    python3 \
    python3-dev \
    py3-pip \
    py3-setuptools \
    build-base \
    linux-headers \
    curl \
    bash \
    git \
    sqlite \
    && rm -rf /var/cache/apk/*

# Install uv for Python package management
RUN pip3 install --no-cache-dir --break-system-packages uv

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code@latest

# Create app user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs -h /home/nodejs -s /bin/bash nodejs

# Create app directory
WORKDIR /app

# Copy package files and install backend dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source
COPY server/ ./server/

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/dist ./dist

# Create necessary directories and set permissions
RUN mkdir -p /home/nodejs/.claude && \
    mkdir -p /app/uploads && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /app && \
    chown -R nodejs:nodejs /home/nodejs

# Copy startup script
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Switch to app user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/config || exit 1

# Start the application
CMD ["/usr/local/bin/start.sh"]