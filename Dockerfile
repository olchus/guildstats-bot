FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY bot.js ./

ENV NODE_ENV=production
CMD ["npm", "start"]