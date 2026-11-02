FROM node:20-alpine AS base

RUN apk add --no-cache curl \
    && corepack enable \
    && for attempt in 1 2 3 4 5; do \
         corepack prepare pnpm@9.15.0 --activate && break; \
         if [ "$attempt" -eq 5 ]; then exit 1; fi; \
         sleep $((attempt * 2)); \
       done \
    && pnpm --version

WORKDIR /app

# Copy root configuration and dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/indexer/ ./apps/indexer/
COPY apps/keeper/ ./apps/keeper/
COPY scripts/ ./scripts/
COPY deployments/ ./deployments/

# Ensure all dependencies including devDependencies (tsup, typescript) are installed for building
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile --prod=false

# Build shared packages and backend applications
RUN pnpm --filter @zkblast/database build \
    && pnpm --filter @zkblast/observability build \
    && pnpm --filter @zkblast/sdk build \
    && pnpm --filter @zkblast/api build \
    && pnpm --filter @zkblast/indexer build \
    && pnpm --filter @zkblast/keeper build

ENV NODE_ENV=production
ENV API_PORT=3001
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "scripts/run-backend-services.mjs"]
