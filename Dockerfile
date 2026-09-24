# Stage 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/goalguru.db

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 goalguru

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend & static UI assets
COPY --from=builder /app/dist ./dist
COPY public ./public

# Prepare persistent data directory
RUN mkdir -p /app/data && chown -R goalguru:nodejs /app/data

USER goalguru

EXPOSE 3000

CMD ["node", "dist/server/server.js"]
