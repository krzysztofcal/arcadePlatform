FROM node:20-alpine

WORKDIR /app/ws-server

COPY ws-server/package.json ws-server/package-lock.json ./
RUN npm ci --omit=dev

COPY ws-server ./

WORKDIR /app

COPY shared/poker-domain ./shared/poker-domain
COPY netlify/functions/_shared/chips-ledger.mjs ./netlify/functions/_shared/
COPY netlify/functions/_shared/poker-*.mjs ./netlify/functions/_shared/
COPY netlify/functions/_shared/supabase-admin.mjs ./netlify/functions/_shared/


EXPOSE 3000

CMD ["node", "ws-server/server.mjs"]
