FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy root configuration and dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/indexer/ ./apps/indexer/
COPY apps/keeper/ ./apps/keeper/
COPY scripts/ ./scripts/
COPY deployments/ ./deployments/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages and backend applications
RUN pnpm --filter @zkblast/config build \
    && pnpm --filter @zkblast/database build \
    && pnpm --filter @zkblast/abi build \
    && pnpm --filter @zkblast/observability build \
    && pnpm --filter @zkblast/sdk build \
    && pnpm --filter @zkblast/api build \
    && pnpm --filter @zkblast/indexer build \
    && pnpm --filter @zkblast/keeper build

ENV NODE_ENV=production
ENV API_PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "scripts/run-backend-services.mjs"]
