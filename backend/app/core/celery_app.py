"""
Celery Application Configuration
Async task queue for Discovery module background processing
"""

import os
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

# Redis URL from environment or default
# Render provides REDIS_URL with rediss:// (TLS) protocol
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Handle Render's Redis TLS connection
# Render uses rediss:// which requires SSL, but their internal network is secure
BROKER_URL = REDIS_URL
BACKEND_URL = REDIS_URL

# For Render's Redis with TLS, we need to add SSL options
if REDIS_URL.startswith("rediss://"):
    # Append SSL options for Render's managed Redis
    BROKER_URL = REDIS_URL + "?ssl_cert_reqs=none"
    BACKEND_URL = REDIS_URL + "?ssl_cert_reqs=none"

# Initialize Celery
celery_app = Celery(
    "alphaseeker",
    broker=BROKER_URL,
    backend=BACKEND_URL,
    include=["app.workers.tasks"]
)

# Celery Configuration
celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    
    # Timezone
    timezone="Asia/Kolkata",
    enable_utc=True,
    
    # Task settings
    task_track_started=True,
    task_time_limit=600,  # 10 minutes max per task
    task_soft_time_limit=540,  # Soft limit at 9 minutes
    
    # Result settings
    result_expires=3600,  # Results expire after 1 hour
    
    # Worker settings
    worker_prefetch_multiplier=1,  # Prevent prefetching (for long tasks)
    worker_concurrency=2,  # 2 parallel workers
    
    # Retry settings
    task_acks_late=True,  # Acknowledge after task completes
    task_reject_on_worker_lost=True,
    
    # Broker connection retry (important for cloud deployments)
    broker_connection_retry_on_startup=True,
)

