FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY src/package*.json ./
RUN npm ci
COPY src/client ./client
COPY src/vite.config.js ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-dejavu-core
COPY src/package*.json ./
RUN npm ci --omit=dev
COPY src/server ./server
COPY --from=build /app/dist ./dist
ENV PORT=34090 CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 34090
CMD ["npm", "start"]
