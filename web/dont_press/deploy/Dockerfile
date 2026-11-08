FROM python:3.12-alpine
WORKDIR /app
COPY app.py ./
COPY static/ ./static/
RUN adduser -D -H appuser
USER appuser
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8000/api/state >/dev/null || exit 1
CMD ["python", "app.py"]
