# syntax=docker/dockerfile:1.7
#
# The release's two images (OPS-2, OPS-3), built by .github/workflows/deploy.yml:
#
#   docker build -f docker/Dockerfile --target app   --build-arg COMMIT=<sha> .
#   docker build -f docker/Dockerfile --target tools --build-arg COMMIT=<sha> .
#
# app    the Next.js standalone server, run as a non-root user, with a health check
# tools  the whole project with every dependency: migrations, the lists seed and the scripts

ARG NODE_IMAGE=node:22.23.0-bookworm-slim

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
# from the server's .env, and these never reach the app image.
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

# The code belongs to root and only the uploads folder and Next's cache are writable by the app.
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
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN mkdir -p /data/files && chown node:node /data/files
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
