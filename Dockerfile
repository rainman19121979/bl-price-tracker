# Multi-stage build for the Next.js app + workers.
# One image, three roles — CMD selects the process (web / crawler / scheduler).

########## deps ##########
FROM node:20-alpine AS deps
# libc6-compat: some npm deps expect glibc (Prisma, sharp)
# openssl: Prisma engine needs it at both build and runtime
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
# ci is deterministic and faster than install; --ignore-scripts skips postinstall
# so we can run prisma generate ourselves in the builder stage (needs full source)
RUN npm ci --ignore-scripts

########## builder ##########
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args stubbed for the compile step — real values come from
# the compose env at runtime. Prisma just needs *any* URL to generate.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXTAUTH_SECRET="build-time-placeholder-min-32-chars-long-xxxxx"
ENV NEXTAUTH_URL="http://localhost:3000"
# 64 hex chars — encryption module validates length at import time
ENV ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"

RUN npx prisma generate
RUN npm run build

########## runner ##########
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for the runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# The Next.js standalone bundle: server + only the needed node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ is optional — only copy if it exists (this repo doesn't ship one)

# Worker files (crawler / scheduler) run outside the Next.js standalone
# bundle — copy source + full node_modules + prisma schema + tsx runner.
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.worker.json ./tsconfig.worker.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# tini reaps zombie children and forwards SIGTERM cleanly
ENTRYPOINT ["/sbin/tini", "--"]

# Default role is the web server; compose overrides for crawler + scheduler.
CMD ["node", "server.js"]
