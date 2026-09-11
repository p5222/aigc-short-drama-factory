FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
# Alpine's community package supplies the official GitHub CLI credential helper.
RUN apk add --no-cache git openssh-client github-cli ca-certificates \
    && addgroup -g 10001 hub && adduser -D -u 10001 -G hub hub
WORKDIR /app
COPY tools/project-hub/ ./
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=4319 HOME=/tmp/hub-home
USER 10001:10001
CMD ["node", "server.mjs"]
