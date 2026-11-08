FROM debian:bookworm-slim AS native
RUN apt-get update && apt-get install -y --no-install-recommends socat
COPY public/chamber /srv/chamber/chamber
COPY public/libc.so.6 /srv/chamber/libc.so.6
COPY public/ld-linux-x86-64.so.2 /srv/chamber/ld-linux-x86-64.so.2
COPY run-native.sh /srv/chamber/run-native.sh
COPY flag.txt /srv/chamber/flag.txt
RUN chmod 0555 /srv/chamber/chamber /srv/chamber/ld-linux-x86-64.so.2 /srv/chamber/run-native.sh && chmod 0444 /srv/chamber/flag.txt
USER 65534:65534
EXPOSE 34120
CMD ["socat", "TCP-LISTEN:34120,reuseaddr,fork", "EXEC:/srv/chamber/run-native.sh"]

FROM node:22-bookworm-slim AS visual-build
WORKDIR /app
COPY src/visual/package*.json ./
RUN npm ci
COPY src/visual/client ./client
COPY src/visual/vite.config.js ./
RUN npm run build

FROM node:22-bookworm-slim AS visual
WORKDIR /app
COPY src/visual/package*.json ./
RUN npm ci --omit=dev
COPY src/visual/server ./server
COPY --from=visual-build /app/dist ./dist
COPY public ./downloads
ENV WEB_PORT=34121 NATIVE_HOST=labx_containment_array_native NATIVE_PORT=34120
EXPOSE 34121
CMD ["node", "server/index.mjs"]
