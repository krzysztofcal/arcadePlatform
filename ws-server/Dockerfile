FROM node:20-alpine

WORKDIR /app/ws-server

COPY ws-server/package.json ws-server/package-lock.json ./
RUN npm ci --omit=dev

COPY ws-server ./

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY netlify/functions/_shared ./netlify/functions/_shared

EXPOSE 3000

CMD ["node", "ws-server/server.mjs"]
