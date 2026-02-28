FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY poker ./poker

EXPOSE 3000

CMD ["node", "server.mjs"]
