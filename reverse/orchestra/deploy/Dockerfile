FROM python:3.12-slim-bookworm
RUN useradd --uid 10001 --no-create-home orchestra
WORKDIR /app

COPY web/ ./

RUN chmod 0555 /app/bin/lead-part-tester

USER 10001
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"
CMD ["python3", "-B", "server.py", "--host", "0.0.0.0", "--port", "8080"]
