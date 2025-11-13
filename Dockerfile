# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Create data directory
RUN mkdir -p /data

# Expose the port
EXPOSE 3001

# Set environment variables
ENV PORT=3001
ENV DATABASE_PATH=/data/database.db
ENV NODE_ENV=production

# Run the application
CMD ["node", "server/index.js"]
