# Stage 1: Frontend dependencies (if needed for build)
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./

# Install only production dependencies (no devDependencies needed in runtime)
RUN npm ci --omit=dev

# Stage 2: Python dependencies builder
FROM python:3.11-slim AS python-builder

WORKDIR /app

# Install system dependencies needed for building Python packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        libc-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 3: Final runtime image
FROM python:3.11-slim

# Labels for metadata
LABEL maintainer="CSPM Report Builder Team" \
      version="1.0.0" \
      description="A self-hosted tool for building cloud security reports with Wiz integration and Hebrew PDF export"

WORKDIR /app

# Install only runtime system dependencies for Playwright Chromium + Hebrew fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
        libasound2t64 libxshmfence1 libxfixes3 libx11-xcb1 \
        fonts-noto fonts-noto-cjk fonts-unifont \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security BEFORE copying dependencies
RUN useradd -m -u 1000 -s /bin/bash appuser && \
    mkdir -p output uploads/states && \
    chown -R appuser:appuser /app

# Copy Python dependencies from builder stage to appuser's home
COPY --from=python-builder --chown=appuser:appuser /root/.local /home/appuser/.local

# Copy frontend dependencies from frontend-builder (if any runtime assets needed)
COPY --from=frontend-builder /app/node_modules ./node_modules

# Make pip packages available for appuser
ENV PATH=/home/appuser/.local/bin:$PATH

# Switch to non-root user BEFORE installing Playwright
USER appuser

# Install Playwright Chromium browser as appuser
RUN playwright install chromium

# Copy application source code (do this last for better layer caching)
COPY --chown=appuser:appuser . .

EXPOSE 8080

# Use exec form of CMD for proper signal handling
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120", "app:app"]
