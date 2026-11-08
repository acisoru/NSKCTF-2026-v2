FROM python:3.13.12-slim
WORKDIR /task
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ src/
CMD ["python", "src/build.py", "--output", "/output"]
