FROM node:26-trixie-slim AS base
RUN npm install --global pnpm@11.28.8
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN mkdir -p /data/media && chown node:node /app /data /data/media
USER node

FROM base AS production
RUN pnpm build
ENV NODE_ENV=production
CMD ["pnpm", "start"]
