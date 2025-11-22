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

# Create necessary directories with proper permissions
RUN mkdir -p /data /config && \
    chown -R node:node /app /data /config

# Switch to node user (uid/gid 1000)
USER node

# Environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/data/auth.db

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server/index.js"]
