# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

ENV NODE_ENV=production \
    PORT=11435 \
    PROXY_STREAM_MODE=incremental \
    CODEX_MODEL=gpt-5

WORKDIR /app

# Install dependencies (prefer npm ci when lockfile exists)
COPY package.json package-lock.json ./
# Avoid running dev lifecycle scripts (husky) during production install
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Bake Codex CLI into the image so runtime does not rely on host mounts
RUN cp -R node_modules/@openai/codex /usr/local/lib/codex-cli && \
    ln -sf /usr/local/lib/codex-cli/bin/codex.js /usr/local/bin/codex

ENV CODEX_BIN=/usr/local/lib/codex-cli/bin/codex.js

# Copy application sources
COPY server.js ./
COPY README.md ./
COPY src ./src
COPY config ./config

# Run as non-root
USER node

EXPOSE 11435

# Launch the proxy
CMD ["node", "server.js"]
