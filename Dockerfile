FROM node:26-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.16.1
WORKDIR /app
RUN mkdir -p /data/media && chown node:node /app /data /data/media
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/
COPY --chown=node:node apps/web/package.json ./apps/web/
COPY --chown=node:node packages/shared/package.json ./packages/shared/
USER node
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .

FROM base AS production
ARG RELEASE_VERSION=""
RUN BEACON_RELEASE_VERSION="$RELEASE_VERSION" pnpm build
ENV NODE_ENV=production
CMD ["pnpm", "start"]
