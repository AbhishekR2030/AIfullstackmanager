import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import requests
from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


def _resolve_database_url():
    url = os.getenv("DATABASE_URL", "sqlite:///./users.db")
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


ZERODHA_SQLALCHEMY_DATABASE_URL = _resolve_database_url()
ZERODHA_TOKEN_ENGINE = create_engine(
    ZERODHA_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in ZERODHA_SQLALCHEMY_DATABASE_URL else {},
)
ZERODHA_TOKEN_SESSION = sessionmaker(autocommit=False, autoflush=False, bind=ZERODHA_TOKEN_ENGINE)
ZERODHA_TOKEN_BASE = declarative_base()


class BrokerToken(ZERODHA_TOKEN_BASE):
    __tablename__ = "broker_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, nullable=False, index=True)
    broker = Column(String(32), nullable=False, index=True)
    access_token = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)


ZERODHA_TOKEN_BASE.metadata.create_all(bind=ZERODHA_TOKEN_ENGINE)


class ZerodhaEngine:
    def __init__(self):
        self.api_key = os.getenv("ZERODHA_API_KEY", "")
        self.api_secret = os.getenv("ZERODHA_API_SECRET", "")
        self.login_base = "https://kite.zerodha.com/connect/login"
        self.session_token_url = "https://api.kite.trade/session/token"
        self.holdings_url = "https://api.kite.trade/portfolio/holdings"

    def _upsert_broker_token(self, user_email: str, access_token: str, expires_at: datetime):
        db = ZERODHA_TOKEN_SESSION()
        try:
            normalized_email = (user_email or "").strip().lower()
            record = (
                db.query(BrokerToken)
                .filter(BrokerToken.user_email == normalized_email, BrokerToken.broker == "ZERODHA")
                .order_by(BrokerToken.id.desc())
                .first()
            )
            if record:
                record.access_token = access_token
                record.expires_at = expires_at
                record.created_at = datetime.utcnow()
            else:
                db.add(
                    BrokerToken(
                        user_email=normalized_email,
                        broker="ZERODHA",
                        access_token=access_token,
                        expires_at=expires_at,
                    )
                )
            db.commit()
        finally:
            db.close()

    def _get_broker_token(self, user_email: str) -> Optional[BrokerToken]:
        db = ZERODHA_TOKEN_SESSION()
        try:
            normalized_email = (user_email or "").strip().lower()
            return (
                db.query(BrokerToken)
                .filter(BrokerToken.user_email == normalized_email, BrokerToken.broker == "ZERODHA")
                .order_by(BrokerToken.id.desc())
                .first()
            )
        finally:
            db.close()

    def _next_reset_utc(self) -> datetime:
        ist = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist)
        reset_ist = now_ist.replace(hour=6, minute=0, second=0, microsecond=0)
        if now_ist >= reset_ist:
            reset_ist = reset_ist + timedelta(days=1)
        return reset_ist.astimezone(timezone.utc).replace(tzinfo=None)

    def get_login_url(self) -> Optional[str]:
        if not self.api_key:
            return None
        return f"{self.login_base}?api_key={self.api_key}&v=3"

    def exchange_request_token(self, request_token: str, user_email: str) -> Dict:
        if not self.api_key or not self.api_secret:
            return {"error": "ZERODHA credentials missing"}
        if not request_token:
            return {"error": "Missing request_token"}

        checksum_raw = f"{self.api_key}{request_token}{self.api_secret}".encode("utf-8")
        checksum = hashlib.sha256(checksum_raw).hexdigest()

        try:
            response = requests.post(
                self.session_token_url,
                data={
                    "api_key": self.api_key,
                    "request_token": request_token,
                    "checksum": checksum,
                },
                timeout=15,
            )
            if response.status_code != 200:
                return {"error": f"Zerodha token exchange failed: {response.status_code} {response.text}"}

            payload = response.json().get("data", {})
            access_token = payload.get("access_token")
            if not access_token:
                return {"error": "Zerodha token exchange failed: no access_token in response"}

            expires_at = self._next_reset_utc()
            self._upsert_broker_token(user_email=user_email, access_token=access_token, expires_at=expires_at)
            return {"access_token": access_token, "expires_at": expires_at.isoformat()}
        except Exception as exc:
            return {"error": str(exc)}

    def _resolve_valid_token(self, user_email: str) -> Dict:
        token_row = self._get_broker_token(user_email)
        if not token_row:
            return {"error": "Zerodha authorization missing. Please connect your account."}
        if token_row.expires_at <= datetime.utcnow():
            return {"error": "BROKER_TOKEN_EXPIRED"}
        return {"token": token_row.access_token}

    def fetch_holdings(self, user_email: str) -> Dict:
        token_info = self._resolve_valid_token(user_email)
        if "error" in token_info:
            return token_info

        access_token = token_info["token"]
        headers = {"Authorization": f"token {self.api_key}:{access_token}"}

        try:
            response = requests.get(self.holdings_url, headers=headers, timeout=15)
            if response.status_code in {401, 403}:
                return {"error": "BROKER_TOKEN_EXPIRED"}
            if response.status_code != 200:
                return {"error": f"Failed to fetch Zerodha holdings: {response.status_code}"}
            payload = response.json().get("data", [])
            return {"holdings": payload}
        except Exception as exc:
            return {"error": str(exc)}

    def to_portfolio_items(self, holdings: List[Dict]) -> List[Dict]:
        normalized = []
        for item in holdings or []:
            symbol = (item.get("tradingsymbol") or "").strip().upper()
            if not symbol:
                continue
            quantity = float(item.get("quantity", 0) or 0)
            if quantity <= 0:
                continue
            average_price = float(item.get("average_price", 0) or 0)
            normalized.append(
                {
                    "ticker": f"{symbol}.NS",
                    "company_name": symbol,
                    "quantity": int(quantity),
                    "buy_price": average_price if average_price > 0 else float(item.get("last_price", 0) or 0),
                    "buy_date": datetime.utcnow().strftime("%Y-%m-%d"),
                    "source": "ZERODHA",
                }
            )
        return normalized


zerodha_engine = ZerodhaEngine()
