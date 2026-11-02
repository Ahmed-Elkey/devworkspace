FROM node:24-alpine AS base

# libc-compat for prebuilt binaries (sharp, prisma engines)
RUN apk add --no-cache libc6-compat

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate
WORKDIR /app

# --- Dependency manifests first (cacheable install layer) ---
# pnpm-workspace.yaml matches apps/* and packages/*, so every member's
# package.json must exist before `pnpm install --frozen-lockfile`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/server/package.json ./packages/server/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --frozen-lockfile

# --- Sources + build ---
COPY apps ./apps
COPY packages ./packages

RUN pnpm --filter @devworkspace/database generate
RUN pnpm build

# --- Runtime configuration for Hugging Face Docker Spaces ---
ENV NODE_ENV=production
ENV API_PORT=7860
ENV BIND_HOST=0.0.0.0
ENV EXPERIMENT_AUTH_ENABLED=false

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
USER nodejs

EXPOSE 7860

CMD ["node", "apps/api/dist/main.js"]
