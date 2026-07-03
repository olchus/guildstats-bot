FROM node:20-bookworm-slim

# Chromium + fonty (ładny rendering tekstu i emoji)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-dejavu-core \
      fonts-liberation \
      fonts-noto-color-emoji \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Najpierw zależności — dzięki temu warstwa npm cache'uje się,
# gdy zmienia się tylko kod (szybsze buildy w GitHub Actions).
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Kod aplikacji
COPY . .

# Uruchamiaj jako użytkownik bez roota (bezpieczniej).
# Obraz node:* ma gotowego użytkownika "node".
RUN chown -R node:node /app
USER node

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

CMD ["node", "src/index.js"]
