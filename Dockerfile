FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV PORT=3001
EXPOSE 3001
CMD ["node", "server/index.js"]
