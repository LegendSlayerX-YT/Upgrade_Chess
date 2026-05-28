FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8001
EXPOSE 8001

CMD ["sh", "-c", "gunicorn --worker-class gthread --workers 1 --threads 100 --bind 0.0.0.0:${PORT} server:app"]
