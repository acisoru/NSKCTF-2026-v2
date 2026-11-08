FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsodium23 socat \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY src/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY src/generate.py src/challenge.py ./
COPY run.sh ./run.sh
RUN chmod 0555 /srv/run.sh
ENV PYTHONDONTWRITEBYTECODE=1 LEDGER_SIZE=6144 SOLVE_SECONDS=888
USER 65534:65534
EXPOSE 34212
CMD ["socat", "TCP-LISTEN:34212,reuseaddr,fork", "EXEC:/srv/run.sh,stderr"]
