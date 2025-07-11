# Use Node.js version from .nvmrc
FROM node:20.19.3-alpine

# Set working directory
WORKDIR /app

# Install system dependencies needed for some npm packages
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    curl

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm ci --only=production && npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership of app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port
EXPOSE 3008

# Start the server only (build already completed)
CMD ["npm", "run", "server"]