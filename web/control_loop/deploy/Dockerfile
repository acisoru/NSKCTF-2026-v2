FROM python:3.12 AS builder
WORKDIR /app

RUN pip install --no-cache-dir uv

COPY src/pyproject.toml src/uv.lock ./

RUN uv venv && uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
WORKDIR /app

RUN useradd --create-home --shell /bin/bash appuser

COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY src/public/.env ./public/.env
COPY src/public/main.py ./public/main.py
COPY src/public/templates/ ./public/templates/
COPY src/public/static/ ./public/static/
COPY src/public/src/ ./public/src/

COPY src/admin/.env ./admin/.env
COPY src/admin/main.py ./admin/main.py
COPY src/admin/src/ ./admin/src/

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R appuser:appuser /app

USER appuser

CMD ["./entrypoint.sh"]
