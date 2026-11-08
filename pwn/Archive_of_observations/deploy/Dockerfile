FROM python:3.12-slim AS base
RUN pip install --no-cache-dir bcrypt==4.2.1 pillow==11.0.0

FROM base AS init
COPY bootstrap.py /bootstrap.py
CMD ["python", "/bootstrap.py"]

FROM debian:bookworm-slim AS formatter
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY logfmt.c /src/logfmt.c
RUN gcc -O2 -Wall -Wextra -fstack-protector-strong -pie -fPIE -Wl,-z,relro,-z,now -o /usr/local/bin/logfmt /src/logfmt.c && useradd -u 10001 -M -s /usr/sbin/nologin formatter
USER 10001:10001
CMD ["/usr/local/bin/logfmt"]

FROM base AS web
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN useradd -u 10002 -M -s /usr/sbin/nologin alice
COPY web.py /app/web.py
COPY captcha.py /app/captcha.py
USER 10002:10002
CMD ["python", "/app/web.py"]
