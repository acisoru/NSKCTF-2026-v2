FROM debian:bookworm-slim AS build
ARG FLAG
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev python3 && rm -rf /var/lib/apt/lists/*
COPY  alice_auth.c /src/alice_auth.c
COPY  genartifacts.py /genartifacts.py
RUN test -n "${FLAG}" \
    && mkdir -p /out && gcc -O2 -Wall -Wextra -fstack-protector-strong -D_FORTIFY_SOURCE=2 -pie -fPIE -o /out/alice-auth /src/alice_auth.c && strip /out/alice-auth \
    && python3 /genartifacts.py /home/archive/artifacts 120 "${FLAG}" 20181030

FROM python:3.12-slim AS web
RUN pip install --no-cache-dir bcrypt==4.2.1 \
    && apt-get update && apt-get install -y --no-install-recommends \
       tree file less diffutils xxd bsdmainutils binutils gzip tar util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 11000 -M -s /usr/sbin/nologin flagreader \
    && useradd -u 11001 -M -d /home/user -s /bin/bash user
COPY --from=build /out/alice-auth /bin/alice-auth
COPY --from=build /home /home
COPY --from=build /etc/alice /etc/alice
COPY --from=build /var/lib/alice /var/lib/alice
COPY --from=build /var/log/alice /var/log/alice
COPY --from=build /opt/alice /opt/alice
COPY  console.py /app/console.py
COPY  entrypoint.sh /entrypoint.sh
RUN chmod 700 /app /app/console.py /entrypoint.sh \
    && chown flagreader:flagreader /var/lib/alice/flag /bin/alice-auth \
    && chmod 0400 /var/lib/alice/flag && chmod 4755 /bin/alice-auth \
    && chown -R user:user /home/user \
    && chmod 0755 /home /home/archive /home/user /home/mr.x /etc/alice /opt/alice /var/lib/alice /var/log/alice \
    && chmod -R a-w /home/archive /home/user /home/mr.x /etc/alice /opt/alice /var/log/alice \
    && chmod 0555 /home/archive/artifacts \
    && find /home/archive/artifacts -type d -exec chmod 555 {} + \
    && find /home/archive/artifacts -type f -exec chmod 444 {} + \
    && chmod 0444 /etc/alice/archive.conf /opt/alice/manifest.txt /var/log/alice/restore.log \
    && chown root:root /home /home/archive /home/mr.x /etc/alice /opt/alice /var/lib/alice /var/log/alice
USER root
ENV PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
ENTRYPOINT ["/entrypoint.sh"]

FROM python:3.12-slim AS edge
COPY  edge.py /app/edge.py
USER 11002:11002
ENTRYPOINT ["python3", "/app/edge.py"]
