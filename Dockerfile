# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    BILLING_DB=/data/balance.json

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Persist ledger on a Railway volume mounted at /data
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
