# Stage 1: Python dependencies builder
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

# Stage 2: Final runtime image
FROM python:3.11-slim

# Labels for metadata
LABEL maintainer="CSPM Report Builder Team" \
      version="1.0.0" \
      description="A self-hosted tool for building cloud security reports with Wiz integration and Hebrew PDF export"

WORKDIR /app

# Install only runtime system dependencies for Playwright Chromium + Hebrew fonts.
# libatk/libcups/libasound were renamed with a "t64" suffix in Debian 13 (Trixie)
# as part of the 64-bit time_t ABI transition; the older non-t64 names are gone
# on Trixie/Noble. We try the t64 names first and fall back to non-t64 so the
# image builds on both Debian 12 (the current python:3.11-slim) and Debian 13+.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libnss3 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
        libxshmfence1 libxfixes3 libx11-xcb1 \
        fonts-noto fonts-noto-cjk fonts-unifont; \
    apt-get install -y --no-install-recommends \
        libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 \
    || apt-get install -y --no-install-recommends \
        libatk1.0-0 libatk-bridge2.0-0 libcups2 libasound2; \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security BEFORE copying dependencies
RUN useradd -m -u 1000 -s /bin/bash appuser && \
    mkdir -p output uploads/states && \
    chown -R appuser:appuser /app

# Copy Python dependencies from builder stage to appuser's home
COPY --from=python-builder --chown=appuser:appuser /root/.local /home/appuser/.local

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
