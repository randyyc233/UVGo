FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm ci

COPY . .

# Vite embeds VITE_* values into the browser bundle during this build stage.
# The Mapbox access token is intentionally a public browser token, not a secret.
ARG VITE_API_BASE_URL=/api
ARG VITE_MAPBOX_ACCESS_TOKEN=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_MAPBOX_ACCESS_TOKEN=$VITE_MAPBOX_ACCESS_TOKEN
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build


FROM node:22-alpine AS runtime

RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV UPLOAD_DIR=/app/uploads/receipts

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
# Prisma's TypeScript seed imports shared fare and vehicle configuration from
# server/src. Keep the source tree in the runtime image so `prisma db seed`
# remains available from the Coolify container terminal.
COPY --from=build /app/server/src ./server/src

RUN mkdir -p /app/uploads/receipts && chown -R node:node /app

USER node

EXPOSE 4000
VOLUME ["/app/uploads/receipts"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail http://localhost:4000/api/health || exit 1

# Apply committed Prisma migrations before starting the long-running process.
# exec makes Node PID 1 so SIGTERM from Coolify reaches the graceful shutdown handlers.
CMD ["sh", "-c", "npm run prisma:migrate --workspace server && exec node server/dist/index.js"]
