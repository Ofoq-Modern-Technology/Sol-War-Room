# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Builder
# Installs all workspace deps, builds the Vite frontend and esbuild backend.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS builder

# Build tools needed by optional native modules (utf-8-validate, bufferutil, better-sqlite3)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /workspace

# Copy workspace root files first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json tsconfig.base.json ./

# Copy all workspace packages
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/
COPY artifacts/sol-war/ artifacts/sol-war/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build: Vite frontend + esbuild backend bundle
# This produces artifacts/api-server/dist/ containing:
#   server.cjs  — fully bundled backend (WASM embedded, no npm install needed for most deps)
#   public/     — built Vite frontend (served as static files)
#   package.json — lists the few external runtime deps that need npm install
RUN pnpm --filter @workspace/api-server run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Runtime
# Minimal Node.js image. Only the built dist/ and its runtime deps.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

# Copy the built distribution from the builder stage
COPY --from=builder /workspace/artifacts/api-server/dist/ ./

# Install the handful of packages that were not bundled inline by esbuild
RUN npm install --omit=dev --no-audit --no-fund

# Persistent data directory — mount a volume here to keep the database
RUN mkdir -p /data

EXPOSE 8080

ENV PORT=8080 \
    NODE_ENV=production \
    DATABASE_PATH=/data/solwarroom.db

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server.cjs"]
