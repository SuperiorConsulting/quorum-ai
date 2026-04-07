# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install deps (including dev — needed for tsc)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Generate Prisma client, then compile TypeScript
RUN npx prisma generate
RUN npx tsc --outDir dist --noEmit false

# Build Next.js
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 quorum

# Copy built artifacts from builder
COPY --from=builder --chown=quorum:nodejs /app/.next          ./.next
COPY --from=builder --chown=quorum:nodejs /app/dist           ./dist
COPY --from=builder --chown=quorum:nodejs /app/public         ./public
COPY --from=builder --chown=quorum:nodejs /app/node_modules   ./node_modules
COPY --from=builder --chown=quorum:nodejs /app/package.json   ./package.json
COPY --from=builder --chown=quorum:nodejs /app/prisma         ./prisma
COPY --from=builder --chown=quorum:nodejs /app/src/generated  ./src/generated

USER quorum

EXPOSE 3000

# Default: run the web server
# Railway overrides this per-service via railway.toml startCommand
CMD ["node", "dist/server.js"]
