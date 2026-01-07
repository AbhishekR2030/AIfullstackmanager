# Use official Python runtime
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies (needed for libraries like numpy/pandas/bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Render uses the PORT environment variable
ENV PORT=8000
EXPOSE 8000

# Command to run the application using the PORT env variable
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
