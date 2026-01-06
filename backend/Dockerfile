# Use official Python runtime
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies (if needed for libraries like numpy/pandas)
RUN apt-get update && apt-get install -y gcc

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port (Cloud Run uses 8080 by default usually, but we can config)
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
