FROM python:3.11-slim

WORKDIR /app

# Install runtime deps and curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first for layer caching
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && \
    uv sync --frozen --no-dev

# Copy application code
COPY . .

# Create non-root runtime user and writable data dir
RUN useradd -m -u 1000 app && \
    mkdir -p /home/app/.slideforge/data && \
    chown -R app:app /home/app /app

USER app

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
