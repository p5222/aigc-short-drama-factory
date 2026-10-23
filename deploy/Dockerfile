# Build once per Git commit. Restarts run the image without downloads or schema changes.
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN case "$ALPINE_MIRROR" in \
      https://dl-cdn.alpinelinux.org/alpine|https://mirrors.cloud.tencent.com/alpine) ;; \
      *) echo "Unsupported Alpine mirror" >&2; exit 1 ;; \
    esac \
    && sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache openssl ffmpeg font-noto-cjk \
    && corepack enable \
    && corepack prepare pnpm@11.7.0 --activate
FROM runtime AS application
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN pnpm --filter @aifilm/shared build \
    && pnpm --filter @aifilm/api db:generate \
    && pnpm --filter @aifilm/api build \
    && pnpm --filter @aifilm/web build \
    && ffmpeg -hide_banner -f lavfi -i color=c=black:s=64x64:d=0.1 \
       -c:v libx264 -pix_fmt yuv420p /tmp/ffmpeg-smoke.mp4 \
    && rm /tmp/ffmpeg-smoke.mp4
ENV NODE_ENV=production
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "apps/api/dist/server.js"]
