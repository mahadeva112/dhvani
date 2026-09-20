# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
#
# Done in its own stage so the toolchain (Vite, TypeScript, Tailwind) never
# reaches the runtime image.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually changes.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build


# ---------------------------------------------------------------------------
# Stage 2 — production dependencies only
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# ffmpeg comes from the distro package below, so skip the ~80MB ffmpeg-static
# download. Electron is a devDependency and is excluded automatically.
ENV FFMPEG_STATIC_SKIP_DOWNLOAD=1
RUN npm ci --omit=dev --omit=optional && npm cache clean --force


# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# ffmpeg extracts audio from uploaded video; tini reaps zombie ffmpeg processes
# and forwards signals so the container stops cleanly.
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DHVANI_CONFIG_DIR=/config

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY server                          ./server
COPY package.json                    ./package.json

# Keys and saved settings live on a volume, never baked into the image.
RUN mkdir -p /config && chown -R node:node /config /app

USER node

VOLUME ["/config"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
