FROM node:20-bookworm-slim

WORKDIR /app

# Chromium + fonty (ładny rendering tekstu)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-noto-color-emoji \
    fontconfig \
    && rm -rf /var/lib/apt/lists/

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["node", "src/index.js"]
