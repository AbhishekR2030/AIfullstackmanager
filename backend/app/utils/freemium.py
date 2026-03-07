import os
from datetime import datetime
from typing import Any, Dict, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.engines.auth_engine import UsageLog


DEFAULT_BUILDER_EMAILS = {"chabhishekreddy@gmail.com"}


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def canonical_email(email: Optional[str]) -> str:
    normalized = normalize_email(email)
    if "@" not in normalized:
        return normalized
    local_part, domain_part = normalized.split("@", 1)
    if domain_part in {"gmail.com", "googlemail.com"}:
        local_part = local_part.split("+", 1)[0].replace(".", "")
        domain_part = "gmail.com"
    return f"{local_part}@{domain_part}"


def _builder_email_allowlist() -> Set[str]:
    env_value = os.getenv("BUILDER_EMAIL_ALLOWLIST", "")
    env_emails = {canonical_email(item) for item in env_value.split(",") if item.strip()}
    default_emails = {canonical_email(item) for item in DEFAULT_BUILDER_EMAILS}
    return default_emails | env_emails


def is_builder_email(email: Optional[str]) -> bool:
    return canonical_email(email) in _builder_email_allowlist()


def standard_error_payload(
    code: str,
    message: str,
    status_code: int,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
        "status": status_code,
    }


def effective_plan(plan: Optional[str], plan_expires_at: Optional[datetime], email: Optional[str] = None) -> str:
    if is_builder_email(email):
        return "pro"
    normalized = (plan or "free").strip().lower()
    if normalized != "pro":
        return "free"
    if plan_expires_at and plan_expires_at <= datetime.utcnow():
        return "free"
    return "pro"


def is_pro_user(user: Any) -> bool:
    return effective_plan(
        getattr(user, "plan", "free"),
        getattr(user, "plan_expires_at", None),
        getattr(user, "email", None),
    ) == "pro"


def check_daily_limit(user_email: str, action: str, limit: int, db: Session) -> bool:
    """
    Returns True when the user has reached (or exceeded) the configured UTC daily limit.
    """
    if limit <= 0:
        return False

    normalized_email = normalize_email(user_email)
    if is_builder_email(normalized_email):
        return False
    if not normalized_email:
        return True

    utc_day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    usage_count = (
        db.query(UsageLog)
        .filter(
            func.lower(UsageLog.user_email) == normalized_email,
            UsageLog.action == action,
            UsageLog.created_at >= utc_day_start,
        )
        .count()
    )
    return usage_count >= limit


def log_usage(db: Session, user_email: str, action: str) -> UsageLog:
    record = UsageLog(
        user_email=(user_email or "").strip().lower(),
        action=action,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
