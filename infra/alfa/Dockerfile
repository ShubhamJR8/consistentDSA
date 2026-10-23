# Self-hosted Alfa (https://github.com/alfaarghya/alfa-leetcode-api), pinned to a release.
#
# Why this exists instead of the stock image: upstream hardcodes `limit: 120` per IP per hour and a
# 5-minute response cache in src/app.ts, with no way to configure either. Self-hosting the stock image
# therefore changes nothing — this server would be the one IP and hit the same 120. This build patches
# both to read an environment variable. The build FAILS if the patch no longer applies (e.g. after
# bumping ALFA_REF), so a silent revert to 120 can't ship.
#
#   docker build -t commitdsa-alfa infra/alfa
#   docker run -p 3000:3000 commitdsa-alfa      # then LEETCODE_API_BASE_URL=http://<host>:3000
#
# Keep it on a private network: upstream sets CORS to allow every origin and has no authentication.
FROM node:24-alpine AS build
ARG ALFA_REF=v2.0.4
WORKDIR /app
RUN wget -qO- "https://github.com/alfaarghya/alfa-leetcode-api/archive/refs/tags/${ALFA_REF}.tar.gz" \
      | tar xz --strip-components=1
RUN sed -i \
      -e "s/  limit: 120,/  limit: Number(process.env.RATE_LIMIT_PER_HOUR) || 120,/" \
      -e "s/cache('5 minutes')/cache(process.env.CACHE_DURATION || '5 minutes')/" \
      src/app.ts \
 && grep -q "RATE_LIMIT_PER_HOUR" src/app.ts \
 && grep -q "CACHE_DURATION" src/app.ts
RUN npm ci --ignore-scripts && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/swagger.yaml ./
# Per client IP, and this server is the only client. The real ceiling is now how much LeetCode itself
# tolerates from this host's IP, which is not something this build can tell you.
ENV RATE_LIMIT_PER_HOUR=3000
# Short, so "Check submission" sees a fresh solve; upstream's default would show 5-minute-old data.
ENV CACHE_DURATION="20 seconds"
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
