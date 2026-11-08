FROM node:24-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
COPY shared ./shared
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS web
WORKDIR /app
COPY --from=web-build --chown=node:node /app/node_modules ./node_modules
COPY --from=web-build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3388 DATA_DIR=/app/data
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3388/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]

FROM python:3.12-bookworm AS checker
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends iproute2 iputils-ping traceroute tcpdump curl dnsmasq-base bind9-dnsutils busybox openvswitch-switch frr nftables procps ethtool && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir dnspython==2.7.0
WORKDIR /opt/checker
COPY checker ./
ENV PYTHONUNBUFFERED=1
HEALTHCHECK --interval=10s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9134/healthz', timeout=2)"
CMD ["python", "server.py"]
