from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from app.engines.auth_engine import auth_engine, SessionLocal
from app.utils.freemium import effective_plan
import os

# Secret Key (in prod, load from .env)
SECRET_KEY = os.getenv("SECRET_KEY", "super_secret_key_change_me_in_production") 
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class AuthenticatedUser(BaseModel):
    id: Optional[int] = None
    email: str
    plan: str = "free"
    billing_plan: Optional[str] = None
    plan_expires_at: Optional[datetime] = None
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    profession: Optional[str] = None
    is_active: bool = True


def _parse_plan_expiry(raw_value: Optional[str]) -> Optional[datetime]:
    if raw_value is None:
        return None
    if isinstance(raw_value, datetime):
        return raw_value
    text = str(raw_value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if isinstance(to_encode.get("plan_expires_at"), datetime):
        to_encode["plan_expires_at"] = to_encode["plan_expires_at"].isoformat()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        user_id = payload.get("uid")
        plan = (payload.get("plan") or "").strip().lower()
        billing_plan = payload.get("billing_plan")
        expiry = _parse_plan_expiry(payload.get("plan_expires_at"))
        first_name = payload.get("first_name")
        middle_name = payload.get("middle_name")
        last_name = payload.get("last_name")
        profession = payload.get("profession")
    except JWTError:
        raise credentials_exception

    db = SessionLocal()
    try:
        db_user = auth_engine.get_user_by_email(db, email=email)
        if db_user is None:
            raise credentials_exception
        user_id = db_user.id
        if not plan or billing_plan is None:
            plan = auth_engine.get_effective_plan(db_user)
            billing_plan = getattr(db_user, "billing_plan", None)
            expiry = db_user.plan_expires_at
        first_name = getattr(db_user, "first_name", None)
        middle_name = getattr(db_user, "middle_name", None)
        last_name = getattr(db_user, "last_name", None)
        profession = getattr(db_user, "profession", None)
    finally:
        db.close()

    resolved_plan = effective_plan(plan, expiry, email=email)
    if (
        resolved_plan == "free"
        and plan == "pro"
        and expiry
        and expiry <= datetime.utcnow()
    ):
        auth_engine.schedule_expiry_downgrade(email)

    return AuthenticatedUser(
        id=user_id,
        email=email,
        plan=resolved_plan if resolved_plan in {"free", "pro"} else "free",
        billing_plan=billing_plan,
        plan_expires_at=expiry,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        profession=profession,
        is_active=True,
    )
