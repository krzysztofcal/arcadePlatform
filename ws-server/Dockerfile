FROM node:20-alpine

WORKDIR /app/ws-server

COPY ws-server/package.json ws-server/package-lock.json ./
RUN npm ci --omit=dev

COPY ws-server ./

WORKDIR /app

EXPOSE 3000

CMD ["node", "ws-server/server.mjs"]
