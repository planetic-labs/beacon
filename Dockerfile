FROM node:26-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.28.8
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN mkdir -p /data/media && chown node:node /app /data /data/media /app/apps/web/node_modules
USER node

FROM base AS production
RUN pnpm build
ENV NODE_ENV=production
CMD ["pnpm", "start"]
