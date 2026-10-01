# Multi-stage Dockerfile for Age of Fronts All-in-One server (Website + Multiplayer)
FROM node:24-slim AS builder
WORKDIR /usr/src/app

RUN npm install --global --ignore-scripts npm@12.1.0

# Install dependencies needed for build
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source code and resources for frontend build
COPY tsconfig.json vite.skirmish.config.ts index.html ./
COPY resources ./resources
COPY skirmish ./skirmish
COPY src ./src

# Build static skirmish frontend into build/skirmish
RUN npm run build:skirmish

# Production runtime image
FROM node:24-slim AS runner
WORKDIR /usr/src/app

RUN npm install --global --ignore-scripts npm@12.1.0

# Install runtime dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy compiled frontend build from builder
COPY --from=builder /usr/src/app/build/skirmish ./build/skirmish

# Copy application runtime files
COPY tsconfig.json ./
COPY resources ./resources
COPY src ./src

# Create data directory for SQLite persistence
RUN mkdir -p /usr/src/app/data

ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
ENV STATIC_DIR=/usr/src/app/build/skirmish

EXPOSE 8080

CMD ["npm", "run", "start:multiplayer"]
