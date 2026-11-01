FROM node:24.20.0-alpine
RUN apk add --no-cache chromium ca-certificates
ENV NODE_ENV=production APP_ROOT=/app APP_HOST=127.0.0.1 APP_PORT=3180 \
    NODE_OPTIONS=--max-old-space-size=256 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
USER node
CMD ["node", "scripts/serve-standalone.mjs"]
