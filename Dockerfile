FROM node:20-bookworm-slim

# Chromium dependencies for Puppeteer + chromium itself (lighter than full chrome)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /data/screenshots /data/uploads && chmod -R 755 /data

# Volume persistant pour la DB SQLite + screenshots + fallback uploads.
# Coolify Helsinki et Falkenstein créent leur propre volume nommé sur ce mount point.
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/salons.db
ENV SCREENSHOTS_DIR=/data/screenshots

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
