# syntax=docker/dockerfile:1.7
#
# The release's two images (OPS-2, OPS-3), built for amd64 and arm64 by .github/workflows/release.yml:
#
#   docker build -f docker/Dockerfile --target app   --build-arg COMMIT=<sha> .
#   docker build -f docker/Dockerfile --target tools --build-arg COMMIT=<sha> .
#
# app    the Next.js standalone server, run as a non-root user, with a health check
# tools  the whole project with every dependency: migrations, the lists seed and the scripts, run as
#        `prisma ...` and `tsx scripts/...` (node_modules/.bin is on its PATH)
#
# Neither keeps the base image's npm, npx, yarn or corepack: nothing is installed on a server, and
# the package managers' own bundled packages are where the base image's known vulnerabilities are
# (release.yml's scan stops a release on any that has a fix).

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

# ---- Dependencies, and the Prisma client they generate -----------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Prisma picks its migration engine by the OpenSSL it finds, so OpenSSL must be there before npm ci.
RUN apt-get update -q && apt-get install -y -q --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
# prisma.config.ts reads it; nothing connects while the image is built.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS source
COPY . .

# ---- The production build --------------------------------------------------------------------
FROM source AS build
ARG COMMIT=unknown
# The security headers (HSTS among them) are fixed when next.config.ts is read, at build time.
ENV APP_ENV=production
# A page left open across a deploy reloads on its next move instead of failing (AC-29).
ENV NEXT_DEPLOYMENT_ID=${COMMIT}
# Only so the server code can be loaded while pages are collected. The running app gets its own
# from Parameter Store, and these never reach the app image.
ENV BETTER_AUTH_SECRET=build-only-placeholder-never-used-by-a-running-app
ENV BETTER_AUTH_URL=https://build.invalid
RUN npm run build

# ---- app: what the server runs ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS app
ARG COMMIT=unknown
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FILES_DIR=/data/files \
    APP_COMMIT=${COMMIT}
# No package managers (see the top of this file).
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# The code belongs to root and only the uploads folder and Next's cache are writable by the app.
# The servers keep uploads in S3 (FILES_BUCKET); the folder is for a run without it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data/files /app/.next/cache && chown node:node /data/files /app/.next/cache

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]

# ---- tools: migrations, seeds and scripts, run with `docker compose run --rm tools ...` ------------
FROM source AS tools
ARG COMMIT=unknown
ENV NODE_ENV=production \
    FILES_DIR=/data/files \
    APP_COMMIT=${COMMIT} \
    PATH=/app/node_modules/.bin:$PATH
# No package managers (see the top of this file): prisma and tsx come from node_modules/.bin.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data/files && chown node:node /data/files
USER node
CMD ["prisma", "migrate", "deploy"]
