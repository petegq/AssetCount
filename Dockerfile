# ── Stage 1: install production dependencies ──────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npx prisma generate

# ── Stage 2: build TypeScript ──────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npx prisma generate && npm run build

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what's needed to run
COPY --from=deps  /app/node_modules        ./node_modules
COPY --from=deps  /app/prisma              ./prisma
COPY --from=build /app/dist                ./dist
COPY --from=build /app/package.json        ./package.json

# SQLite data volume
RUN mkdir -p /app/data && chown -R appuser:appgroup /app
VOLUME ["/app/data"]

USER appuser

EXPOSE 3000

# Run pending migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
