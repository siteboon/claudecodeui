# Multi-stage Dockerfile for claudecodeui

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build frontend
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine

# Install required system dependencies
RUN apk add --no-cache \
    git \
    openssh-client \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./dist

# Copy server and other necessary files
COPY server ./server
COPY public ./public
COPY index.html ./
COPY vite.config.js ./
COPY postcss.config.js ./
COPY tailwind.config.js ./

# Create necessary directories
RUN mkdir -p /home/nodejs/.claude && \
    chown -R nodejs:nodejs /app /home/nodejs/.claude

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3008 3009

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3008/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["npm", "run", "server"]