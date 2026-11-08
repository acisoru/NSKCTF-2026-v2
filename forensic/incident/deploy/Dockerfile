FROM python:3.12.8-slim-bookworm
WORKDIR /app
COPY c2/control.py c2/file_store.py /app/
RUN useradd --create-home --uid 10001 c2 && mkdir -p /shared /store \
    && chown -R c2:c2 /app /shared /store
USER c2
ENTRYPOINT ["python3", "/app/control.py"]
