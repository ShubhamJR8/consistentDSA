# CommitDSA API. Build context is ./server:   docker build -t commitdsa-server server
#
# Runs one process: the HTTP server plus the background sweeps (settlement, payment reconciliation,
# LeetCode verification). Several replicas are safe — the sweeps take a database lease so only one
# runs each at a time, and rate limits are counted in MongoDB. See server/.env.example for settings;
# in production the server refuses to boot without Razorpay, SMTP and https CLIENT_URL configured.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5001
# Liveness + database. 503 here means the process is up but has lost MongoDB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5001}/api/health" >/dev/null || exit 1
CMD ["node", "dist/server.js"]

# Operator scripts run from the compiled output (tsx is a dev dependency and is not installed here):
#   node dist/scripts/refunds.js list
#   node dist/scripts/refunds.js execute <transactionId>
#   node dist/scripts/seed.js
