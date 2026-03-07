
import os
import requests
import secrets
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, HTTPException, Depends, Request, status, Header, Query
from fastapi.responses import RedirectResponse, JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import timedelta, datetime
from sqlalchemy.orm import Session

from app.engines.analyst_engine import AnalystEngine
from app.engines.screener_engine import ScreenerEngine
from app.engines.portfolio_engine import PortfolioEngine
from app.engines.search_engine import SearchEngine
from app.engines.hdfc_engine import HDFCEngine
from app.engines.zerodha_engine import zerodha_engine
from app.engines.auth_engine import auth_engine
from app.utils.jwt_handler import (
    create_access_token,
    get_current_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    SECRET_KEY,
    ALGORITHM,
)
from app.utils.freemium import check_daily_limit, effective_plan, is_pro_user, standard_error_payload

router = APIRouter()

# Instantiate engines
analyst = AnalystEngine()
screener = ScreenerEngine()
portfolio_manager = PortfolioEngine()
search_engine = SearchEngine()
hdfc_engine = HDFCEngine()

# Auth Models
class UserCreate(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: Optional[Dict[str, Any]] = None

class GoogleLoginRequest(BaseModel):
    id_token: str

class ActivateProRequest(BaseModel):
    email: str
    plan: str
    payment_id: str

def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _error_response(
    status_code: int,
    code: str,
    message: str,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=standard_error_payload(
            code=code,
            message=message,
            status_code=status_code,
            details=details,
        ),
    )


def _issue_token_for_user(user) -> str:
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    user_plan = effective_plan(
        getattr(user, "plan", "free"),
        getattr(user, "plan_expires_at", None),
        getattr(user, "email", None),
    )
    if user_plan == "free" and getattr(user, "plan", "free") == "pro":
        auth_engine.schedule_expiry_downgrade(user.email)

    return create_access_token(
        data={
            "sub": user.email,
            "uid": user.id,
            "plan": user_plan,
            "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
        },
        expires_delta=access_token_expires,
    )


def require_pro(current_user=Depends(get_current_user)):
    if not is_pro_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=standard_error_payload(
                code="PRO_REQUIRED",
                message="This feature is available only on Pro plan.",
                status_code=status.HTTP_403_FORBIDDEN,
                details={"plan": getattr(current_user, "plan", "free")},
            ),
        )
    return current_user

def _resolve_app_redirect(
    explicit_redirect: Optional[str],
    allow_default: bool = True
) -> Optional[str]:
    if explicit_redirect and explicit_redirect.strip():
        return explicit_redirect.strip()
    if not allow_default:
        return None
    default_redirect = (os.getenv("HDFC_APP_REDIRECT_URI", "") or "").strip()
    return default_redirect or None

def _build_redirect_url(base_url: str, params: dict) -> str:
    """
    Safely appends query params while preserving existing query values.
    """
    split_url = urlsplit(base_url)
    merged_query = dict(parse_qsl(split_url.query, keep_blank_values=True))
    merged_query.update({k: v for k, v in params.items() if v is not None})
    return urlunsplit((
        split_url.scheme,
        split_url.netloc,
        split_url.path,
        urlencode(merged_query),
        split_url.fragment
    ))


def _create_zerodha_auth_state(user_email: str, app_redirect: Optional[str]) -> str:
    expires_at = datetime.utcnow() + timedelta(minutes=15)
    payload = {
        "sub": _normalize_email(user_email),
        "broker": "ZERODHA",
        "purpose": "broker_connect",
        "app_redirect": (app_redirect or "").strip(),
        "exp": expires_at,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_zerodha_auth_state(raw_state: Optional[str]) -> Dict[str, str]:
    if not raw_state:
        raise ValueError("Missing broker auth state")

    try:
        payload = jwt.decode(raw_state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired broker auth state") from exc

    if payload.get("broker") != "ZERODHA" or payload.get("purpose") != "broker_connect":
        raise ValueError("Invalid broker auth state")

    user_email = _normalize_email(payload.get("sub"))
    if not user_email:
        raise ValueError("Broker auth state missing user context")

    return {
        "user_email": user_email,
        "app_redirect": (payload.get("app_redirect") or "").strip(),
    }

def _verify_google_id_token(id_token: str):
    """
    Verifies a Google ID token against Google's tokeninfo endpoint.
    """
    if not id_token:
        return None, "Missing Google ID token"

    try:
        response = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
            timeout=10
        )
    except Exception as exc:
        return None, f"Google token verification failed: {exc}"

    if response.status_code != 200:
        return None, "Invalid Google token"

    payload = response.json()
    issuer = payload.get("iss")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        return None, "Invalid Google token issuer"

    allowed_audiences = {
        value.strip()
        for value in [
            os.getenv("GOOGLE_CLIENT_ID", ""),
            os.getenv("GOOGLE_IOS_CLIENT_ID", ""),
            os.getenv("GOOGLE_SERVER_CLIENT_ID", ""),
        ]
        if value and value.strip()
    }
    audience = payload.get("aud")
    if allowed_audiences and audience not in allowed_audiences:
        return None, "Google token audience mismatch"

    email = payload.get("email")
    if not email:
        return None, "Google token missing email"

    return payload, None


def _apply_free_thesis_redaction(payload: Dict[str, Any], force_refresh_requested: bool = False) -> Dict[str, Any]:
    """
    Preserve response shape while redacting premium thesis sections for free users.
    Supports both legacy keys (thesis/risk_factors) and expanded keys (bull_case/bear_case).
    """
    redaction = "Upgrade to Pro to view full analysis"
    result = dict(payload or {})

    if "thesis" in result:
        existing = result.get("thesis") or []
        result["thesis"] = existing[:1] if existing else [redaction]
    if "risk_factors" in result:
        result["risk_factors"] = [redaction]
    if "bull_case" in result:
        result["bull_case"] = [redaction]
    if "bear_case" in result:
        result["bear_case"] = [redaction]

    result["data"] = {
        **(result.get("data") or {}),
        "code": "THESIS_PARTIAL",
        "force_refresh_ignored": bool(force_refresh_requested),
    }
    return result

# --- Auth Routes ---
@router.post("/auth/signup", response_model=Token)
async def signup(user: UserCreate, db: Session = Depends(auth_engine.get_db)):
    email = _normalize_email(user.email)
    print(f"Signup request for: {email}") # Debug log
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    
    db_user = auth_engine.get_user_by_email(db, email=email)
    if db_user:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="EMAIL_EXISTS",
            message="Email already registered",
        )
    
    created_user = auth_engine.create_user(db, email=email, password=user.password)
    print("User created in DB.")
    
    access_token = _issue_token_for_user(created_user)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "email": created_user.email,
            "plan": effective_plan(created_user.plan, created_user.plan_expires_at, created_user.email),
            "plan_expires_at": created_user.plan_expires_at.isoformat() if created_user.plan_expires_at else None,
        },
    }

@router.post("/auth/google", response_model=Token)
async def login_google(data: GoogleLoginRequest, db: Session = Depends(auth_engine.get_db)):
    payload, verify_error = _verify_google_id_token(data.id_token)
    if verify_error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=standard_error_payload(
                code="INVALID_GOOGLE_TOKEN",
                message=verify_error,
                status_code=status.HTTP_401_UNAUTHORIZED,
            ),
        )

    email = _normalize_email(payload.get("email", ""))
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=standard_error_payload(
                code="INVALID_GOOGLE_TOKEN",
                message="Google token missing email",
                status_code=status.HTTP_401_UNAUTHORIZED,
            ),
        )
    user = auth_engine.get_user_by_email(db, email=email)
    if not user:
        # Create user on first Google login
        user = auth_engine.create_user(db, email=email, password=secrets.token_urlsafe(32))

    access_token = _issue_token_for_user(user)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "email": user.email,
            "plan": effective_plan(user.plan, user.plan_expires_at, user.email),
            "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
        },
    }

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/auth/login", response_model=Token)
async def login_json(data: LoginRequest, db: Session = Depends(auth_engine.get_db)):
    email = _normalize_email(data.email)
    user = auth_engine.get_user_by_email(db, email=email)
    
    if not user or not auth_engine.verify_password(data.password, user.hashed_password):
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message="Incorrect email or password",
        )
        
    access_token = _issue_token_for_user(user)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "email": user.email,
            "plan": effective_plan(user.plan, user.plan_expires_at, user.email),
            "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
        },
    }

@router.get("/auth/me")
async def read_users_me(current_user = Depends(get_current_user)):
    user_plan = effective_plan(
        getattr(current_user, "plan", "free"),
        getattr(current_user, "plan_expires_at", None),
        getattr(current_user, "email", None),
    )
    return {
        "email": current_user.email,
        "id": current_user.id,
        "plan": user_plan,
        "plan_expires_at": current_user.plan_expires_at.isoformat() if current_user.plan_expires_at else None,
    }


@router.post("/internal/activate-pro")
async def activate_pro_webhook(
    payload: ActivateProRequest,
    x_webhook_secret: Optional[str] = Header(default=None, alias="X-Webhook-Secret"),
    db: Session = Depends(auth_engine.get_db),
):
    expected_secret = (os.getenv("INTERNAL_WEBHOOK_SECRET", "") or "").strip()
    incoming_secret = (x_webhook_secret or "").strip()

    if not expected_secret or not incoming_secret or not secrets.compare_digest(expected_secret, incoming_secret):
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_WEBHOOK_SECRET",
            message="Webhook authentication failed.",
        )

    email = _normalize_email(payload.email)
    if not email:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_PAYLOAD",
            message="Email is required.",
        )
    if not payload.payment_id or not payload.payment_id.strip():
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_PAYLOAD",
            message="payment_id is required.",
        )
    if payload.plan not in {"monthly", "yearly"}:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_PLAN",
            message="plan must be either 'monthly' or 'yearly'.",
        )

    activated_user = auth_engine.activate_pro_plan(db, email=email, billing_plan=payload.plan)
    if not activated_user:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="USER_NOT_FOUND",
            message="User does not exist.",
        )

    return {
        "status": "ok",
        "email": activated_user.email,
        "plan": activated_user.plan,
        "plan_expires_at": activated_user.plan_expires_at.isoformat() if activated_user.plan_expires_at else None,
        "payment_id": payload.payment_id,
    }

@router.get("/auth/hdfc/login")
async def hdfc_login(redirect_uri: Optional[str] = None):
    """
    Returns the HDFC login page URL.
    """
    login_url = hdfc_engine.get_login_url(redirect_uri)
    if not login_url:
         raise HTTPException(status_code=500, detail="HDFC configuration missing")
    
    return {"login_url": login_url, "redirect_url": login_url}


@router.get("/auth/zerodha/login")
async def zerodha_login(app_redirect: Optional[str] = None, current_user=Depends(require_pro)):
    resolved_redirect = (app_redirect or "").strip() or "com.alphaseeker.india://zerodha/callback"
    auth_state = _create_zerodha_auth_state(current_user.email, resolved_redirect)
    login_url = zerodha_engine.get_login_url({"auth_state": auth_state})
    if not login_url:
        raise HTTPException(status_code=500, detail="Zerodha configuration missing")
    return {
        "login_url": login_url,
        "redirect_url": login_url,
        "app_redirect": resolved_redirect,
    }


@router.get("/auth/zerodha/callback")
async def zerodha_callback(
    request_token: Optional[str] = None,
    auth_state: Optional[str] = None,
    callback_status: Optional[str] = Query(default=None, alias="status"),
    action: Optional[str] = None,
):
    try:
        state_payload = _decode_zerodha_auth_state(auth_state)
    except ValueError as exc:
        return _error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_BROKER_STATE",
            message=str(exc),
        )

    callback_url = state_payload.get("app_redirect") or "com.alphaseeker.india://zerodha/callback"

    def _redirect_callback(payload: Dict[str, Any], fallback_status_code: int):
        if callback_url:
            return RedirectResponse(url=_build_redirect_url(callback_url, payload), status_code=302)
        return _error_response(
            status_code=fallback_status_code,
            code=payload.get("code", "BROKER_SYNC_FAILED"),
            message=payload.get("error") or payload.get("message") or "Broker callback failed",
        )

    if callback_status and callback_status.lower() != "success":
        return _redirect_callback(
            {
                "status": "error",
                "broker": "zerodha",
                "error": f"Zerodha login returned status '{callback_status}'",
                "action": action,
                "code": "BROKER_AUTH_FAILED",
            },
            status.HTTP_400_BAD_REQUEST,
        )

    if not request_token:
        return _redirect_callback(
            {
                "status": "error",
                "broker": "zerodha",
                "error": "request_token is required",
                "action": action,
                "code": "INVALID_PAYLOAD",
            },
            status.HTTP_400_BAD_REQUEST,
        )

    result = zerodha_engine.exchange_request_token(
        request_token=request_token,
        user_email=state_payload["user_email"],
    )
    if "error" in result:
        return _redirect_callback(
            {
                "status": "error",
                "broker": "zerodha",
                "error": result["error"],
                "action": action,
                "code": "BROKER_SYNC_FAILED",
            },
            status.HTTP_400_BAD_REQUEST,
        )

    if callback_url:
        redirect_url = _build_redirect_url(
            callback_url,
            {
                "status": "success",
                "broker": "zerodha",
                "expires_at": result.get("expires_at"),
                "action": action,
            },
        )
        return RedirectResponse(url=redirect_url, status_code=302)

    return {"status": "success", "broker": "zerodha", "expires_at": result.get("expires_at")}

@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: Optional[str] = None, 
    request_token: Optional[str] = None,
    state: Optional[str] = None,
    app_redirect: Optional[str] = None
):
    """
    Generic callback handler for OAuth flows.
    HDFC returns 'request_token' for v1, 'code' for std oauth.
    """
    # App-initiated callback exchanges include Authorization header and should
    # receive JSON responses, not deep-link redirects.
    has_auth_header = bool((request.headers.get("authorization") or "").strip())
    resolved_app_redirect = _resolve_app_redirect(
        app_redirect,
        allow_default=not has_auth_header
    )
    token = code or request_token
    
    if token:
           # Attempt exchange
           result = hdfc_engine.exchange_token(token)

           if "error" in result:
                if resolved_app_redirect:
                    redirect_url = _build_redirect_url(resolved_app_redirect, {
                        "hdfc_status": "error",
                        "error": result.get("error", "Token exchange failed")
                    })
                    return RedirectResponse(url=redirect_url, status_code=302)
                raise HTTPException(
                    status_code=400,
                    detail=result.get("error", "Token exchange failed")
                )

           if resolved_app_redirect:
                redirect_url = _build_redirect_url(resolved_app_redirect, {
                    "hdfc_status": "success"
                })
                return RedirectResponse(url=redirect_url, status_code=302)

           # If successful, we should verify the user and perhaps redirect them back to the frontend
           # For now, simplistic response
           return {
               "success": True,
               "message": "Authorization successful. You can close this window.",
               "access_token": result.get("access_token"),
           }

    if resolved_app_redirect:
        redirect_url = _build_redirect_url(resolved_app_redirect, {
            "hdfc_status": "error",
            "error": "No code received"
        })
        return RedirectResponse(url=redirect_url, status_code=302)

    raise HTTPException(
        status_code=400,
        detail="No code received"
    )

# --- Existing Routes ---
@router.get("/")
async def root():
    return {"message": "Welcome to the API"}

class AnalyzeRequest(BaseModel):
    ticker: str

class TradeRequest(BaseModel):
    ticker: str
    buy_date: str
    buy_price: float
    quantity: int

class AnalyzeResponse(BaseModel):
    recommendation: str
    thesis: List[str]
    risk_factors: List[str]
    bull_case: Optional[List[str]] = None
    bear_case: Optional[List[str]] = None
    confidence_score: int
    data: Optional[dict] = None

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_stock(
    request: AnalyzeRequest,
    force_refresh: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(auth_engine.get_db),
):
    """
    Generates an investment thesis for a given ticker symbol.
    """
    try:
        user_is_pro = is_pro_user(current_user)
        effective_force_refresh = bool(force_refresh and user_is_pro)

        # Cached theses do not count against free daily limits.
        if not effective_force_refresh:
            cached = analyst.get_cached_thesis(request.ticker, current_user.email, db)
            if cached:
                if not user_is_pro:
                    cached = _apply_free_thesis_redaction(
                        cached,
                        force_refresh_requested=bool(force_refresh and not user_is_pro),
                    )
                    cached["data"] = {**(cached.get("data") or {}), "cached": True}
                return cached

        if not user_is_pro and check_daily_limit(current_user.email, "thesis", 3, db):
            return _error_response(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                code="DAILY_LIMIT",
                message="Daily thesis limit reached for free plan.",
                details={"action": "thesis", "limit": 3},
            )

        result = analyst.generate_thesis(
            request.ticker,
            user_email=current_user.email,
            db=db,
            force_refresh=effective_force_refresh,
        )
        
        if "error" in result:
             raise HTTPException(status_code=500, detail=result["error"])

        if not user_is_pro:
            result = _apply_free_thesis_redaction(
                result,
                force_refresh_requested=bool(force_refresh and not user_is_pro),
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/screen")
async def screen_market():
    """
    Returns a list of stocks matching the momentum strategy.
    """
    try:
        matches = screener.screen_market()
        return {"matches": matches, "count": len(matches)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/portfolio/add")
async def add_trade(request: TradeRequest, current_user = Depends(get_current_user)):
    try:
        if not is_pro_user(current_user):
            holdings_count = portfolio_manager.count_holdings(current_user.email)
            if holdings_count >= 10:
                return _error_response(
                    status_code=status.HTTP_403_FORBIDDEN,
                    code="HOLDING_LIMIT",
                    message="Free plan supports up to 10 holdings.",
                    details={"current_holdings": holdings_count, "limit": 10},
                )
        # Pass user email to engine
        return portfolio_manager.add_trade(request.dict(), current_user.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/portfolio")
async def get_portfolio(current_user = Depends(get_current_user)):
    try:
        holdings = portfolio_manager.get_portfolio(current_user.email)
        if not holdings:
            return holdings

        analyzed = rebalancer.analyze_portfolio(holdings, new_candidates=(market_scanner.cache or []))
        analyzed_by_ticker = {item.get("ticker"): item for item in analyzed}

        enriched = []
        for holding in holdings:
            meta = analyzed_by_ticker.get(holding.get("ticker"), {})
            enriched.append(
                {
                    **holding,
                    "sell_urgency_score": meta.get("sell_urgency_score", 0),
                    "sell_urgency_badge": meta.get("sell_urgency_badge", "HOLD"),
                    "primary_sell_signal": meta.get("primary_sell_signal", "Insufficient data"),
                }
            )
        return enriched
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/portfolio/sync/hdfc")
async def sync_hdfc_portfolio(current_user = Depends(require_pro)):
    """
    Fetches latest holdings from HDFC and updates the portfolio.
    """
    try:
        # 1. Fetch from HDFC
        holdings = hdfc_engine.fetch_holdings()
        
        if isinstance(holdings, dict) and "error" in holdings:
             error_detail = str(holdings["error"] or "").strip() or "HDFC sync failed"
             normalized_error = error_detail.lower()
             auth_failure = (
                 "401" in normalized_error
                 or "403" in normalized_error
                 or "unauthoriz" in normalized_error
                 or "expired" in normalized_error
                 or "missing" in normalized_error
                 or "login" in normalized_error
                 or "token" in normalized_error
             )
             raise HTTPException(
                 status_code=status.HTTP_401_UNAUTHORIZED if auth_failure else status.HTTP_400_BAD_REQUEST,
                 detail=error_detail
             )
             
        # 2. Update Portfolio Engine
        result = portfolio_manager.sync_hdfc_trades(holdings, current_user.email)
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/portfolio/sync/zerodha")
async def sync_zerodha_portfolio(current_user = Depends(require_pro)):
    try:
        holdings_response = zerodha_engine.fetch_holdings(current_user.email)
        if "error" in holdings_response:
            if holdings_response["error"] == "BROKER_TOKEN_EXPIRED":
                return _error_response(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    code="BROKER_TOKEN_EXPIRED",
                    message="Zerodha session expired. Please re-connect.",
                )
            return _error_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="BROKER_SYNC_FAILED",
                message=holdings_response["error"],
            )

        holdings = zerodha_engine.to_portfolio_items(holdings_response.get("holdings", []))
        result = portfolio_manager.sync_broker_trades(holdings, current_user.email, source="ZERODHA")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/portfolio/history")
async def get_portfolio_history(period: str = "1y", current_user = Depends(get_current_user)):
    """
    Returns historical portfolio value and invested amount.
    Period options: 1mo, 3mo, 6mo, 1y, ytd, all
    """
    try:
        normalized_period = (period or "").strip().lower()
        if not is_pro_user(current_user) and normalized_period not in {"1m", "1mo"}:
            return _error_response(
                status_code=status.HTTP_403_FORBIDDEN,
                code="HISTORY_LIMIT",
                message="Free plan supports only 1M history.",
                details={"requested_period": period, "allowed_period": "1m"},
            )
        return portfolio_manager.get_portfolio_history(current_user.email, period)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/portfolio/rebalance")
async def get_portfolio_rebalance(current_user = Depends(require_pro)):
    try:
        payload = rebalancer.get_rebalancing_suggestions(current_user.email, db=None, redis=None)
        if market_scanner.last_scan_time:
            payload["last_scan_age_hours"] = round((datetime.utcnow().timestamp() - market_scanner.last_scan_time) / 3600, 2)
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/portfolio/sell-ranking")
async def get_sell_ranking(current_user = Depends(get_current_user)):
    try:
        user_portfolio = portfolio_manager.get_portfolio(current_user.email)
        analyzed_holdings = rebalancer.analyze_portfolio(user_portfolio, new_candidates=market_scanner.cache or [])

        if is_pro_user(current_user):
            return {
                "mode": "composite",
                "ranking": analyzed_holdings,
            }

        limited_ranking = []
        for item in analyzed_holdings:
            trend = (item.get("trend") or "").lower()
            momentum_signal = "negative" if trend == "bearish" else "positive" if trend == "bullish" else "neutral"
            limited_ranking.append({
                "ticker": item.get("ticker"),
                "momentum_signal": momentum_signal,
                "trend": item.get("trend", "Unknown"),
                "recommendation": "REVIEW" if momentum_signal == "negative" else "HOLD",
            })

        return {
            "mode": "momentum_only",
            "ranking": limited_ranking,
            "warning": standard_error_payload(
                code="SELL_RANKING_LIMITED",
                message="Upgrade to Pro for full 4-signal sell urgency ranking.",
                status_code=status.HTTP_403_FORBIDDEN,
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/portfolio/delete/{ticker}")
async def delete_trade(ticker: str, current_user = Depends(get_current_user)):
    try:
        return portfolio_manager.delete_trade(ticker, current_user.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from app.engines.scanner_engine import MarketScanner, scanner as shared_market_scanner
from app.engines.rebalancer_engine import RebalancerEngine

market_scanner = shared_market_scanner if isinstance(shared_market_scanner, MarketScanner) else MarketScanner()
rebalancer = RebalancerEngine()

# Thresholds Request Model
class ThresholdsBody(BaseModel):
    technical: Optional[dict] = None
    fundamental: Optional[dict] = None

class ScanRequestBody(BaseModel):
    strategy: str = "core"
    thresholds: Optional[ThresholdsBody] = None


def _normalize_strategy(strategy: Optional[str]) -> str:
    value = (strategy or "core").strip().lower()
    if not value:
        return "core"
    strategy_aliases = {
        "alphaseeker_core": "core",
        "custom_trade": "custom",
        "janestreet_quant": "jane_street_stat",
        "jane_street": "jane_street_stat",
        "deshaw_quality": "de_shaw_multifactor",
        "de_shaw_quality": "de_shaw_multifactor",
    }
    return strategy_aliases.get(value, value)


def _extract_thresholds_payload(thresholds: Optional[ThresholdsBody]) -> Optional[Dict[str, Dict[str, Any]]]:
    if not thresholds:
        return None
    technical = thresholds.technical or {}
    fundamental = thresholds.fundamental or {}
    if not technical and not fundamental:
        return None
    return {
        "technical": technical,
        "fundamental": fundamental,
    }


@router.get("/discovery/strategies")
async def get_discovery_strategies(current_user = Depends(get_current_user)):
    """
    Returns backend-owned strategy metadata and lock status by user plan.
    """
    active_plan = effective_plan(
        getattr(current_user, "plan", "free"),
        getattr(current_user, "plan_expires_at", None),
        getattr(current_user, "email", None),
    )
    strategies = market_scanner.get_supported_strategies()
    for strategy in strategies:
        tier = (strategy.get("strategy_tier") or "free").strip().lower()
        strategy["locked"] = bool(tier == "pro" and active_plan != "pro")
    return {
        "active_plan": active_plan,
        "strategies": strategies,
    }

# Main Discovery Scan Endpoint (POST with thresholds)
@router.post("/discovery/scan")
async def scan_opportunities(
    request: ScanRequestBody = ScanRequestBody(),
    current_user = Depends(get_current_user)
):
    """
    Scans for new buy opportunities and rebalancing candidates.
    Accepts user-defined thresholds for screening.
    """
    try:
        strategy = _normalize_strategy(request.strategy)
        thresholds = _extract_thresholds_payload(request.thresholds)

        if not is_pro_user(current_user):
            if strategy != "core":
                return _error_response(
                    status_code=status.HTTP_403_FORBIDDEN,
                    code="STRATEGY_LOCKED",
                    message=f"Strategy '{strategy}' is available only on Pro plan.",
                    details={"strategy": strategy},
                )
            if thresholds:
                return _error_response(
                    status_code=status.HTTP_403_FORBIDDEN,
                    code="PRO_REQUIRED",
                    message="Custom thresholds are available only on Pro plan.",
                )
        
        # 1. Run Market Scanner with thresholds
        user_plan = effective_plan(
            getattr(current_user, "plan", "free"),
            getattr(current_user, "plan_expires_at", None),
            getattr(current_user, "email", None),
        )
        buy_candidates = market_scanner.scan_market(
            thresholds=thresholds,
            strategy=strategy,
            user_plan=user_plan,
        )
        if not is_pro_user(current_user) and len(buy_candidates) > 10:
            buy_candidates = buy_candidates[:10]
        
        # 2. Analyze Portfolio (Rebalancer)
        user_portfolio = portfolio_manager.get_portfolio(current_user.email)
        analyzed_holdings = rebalancer.analyze_portfolio(user_portfolio)
        
        # --- Generate Thesis for Top Pick (AUTO) ---
        if buy_candidates:
            top_pick = buy_candidates[0]
            # Check if thesis already exists or generate it
            if "thesis" not in top_pick:
                print(f"Generating Investment Thesis for Top Pick: {top_pick.get('ticker', 'UNKNOWN')}...")
                try:
                    # This call uses Gemini 2.0 Flash (Fast)
                    analysis = analyst.generate_thesis(top_pick.get('ticker', ''))
                    if "error" not in analysis:
                        top_pick["thesis"] = analysis.get("thesis", [])
                        top_pick["risk_factors"] = analysis.get("risk_factors", [])
                        top_pick["recommendation"] = analysis.get("recommendation", "BUY")
                        top_pick["confidence"] = analysis.get("confidence_score", 0)
                except Exception as e:
                    print(f"Thesis Generation Failed: {e}")

        # 3. Generate Recommendations
        recommendations = {
            "buy_candidates": buy_candidates,
            "sell_candidates": [],
            "keepers": []
        }
        
        # Organize holdings
        for asset in analyzed_holdings:
            if asset.get('recommendation') == 'SELL_CANDIDATE':
                recommendations['sell_candidates'].append(asset)
            else:
                recommendations['keepers'].append(asset)
                
        # If we have sell candidates and buy candidates, create swap suggestions
        swap_opportunities = []
        if recommendations['sell_candidates'] and buy_candidates:
            sorted_sells = sorted(recommendations['sell_candidates'], key=lambda x: x.get('pl_percent', 0))
            top_buy = buy_candidates[0]
            
            for index, sell in enumerate(sorted_sells):
                swap_opportunities.append({
                    "priority": index + 1,
                    "sell": sell.get('ticker', 'UNKNOWN'),
                    "buy": top_buy.get('ticker', 'UNKNOWN'),
                    "reason": f"Sell weak {sell.get('ticker')} (Trend {sell.get('trend')}, Returns {sell.get('pl_percent')}%) to buy strong {top_buy.get('ticker')} (Momentum Score {top_buy.get('score')})"
                })
        
        strategy_metadata = market_scanner.get_strategy_payload(strategy)
        response = {
            "status": "complete",
            "strategy": strategy,
            "strategy_metadata": strategy_metadata,
            "scan_metadata": getattr(market_scanner, "last_scan_metadata", {}) or {},
            "scan_results": buy_candidates,
            "portfolio_analysis": analyzed_holdings,
            "swap_opportunities": swap_opportunities
        }
        if not is_pro_user(current_user):
            response["result_notice"] = {
                "code": "RESULTS_CAPPED",
                "message": "Free plan returns top 10 results.",
            }
        return response

    except Exception as e:
        print(f"Discovery Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search")
async def search_ticker(q: str):
    """
    Searches for stocks by name or ticker.
    """
    try:
        return search_engine.search(q)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ASYNC DISCOVERY ENDPOINTS (Celery + Redis)
# ============================================================================
from app.workers.tasks import master_scan_workflow, get_scan_progress, get_scan_results
from celery.result import AsyncResult
from app.core.celery_app import celery_app

class AsyncScanRequest(BaseModel):
    region: str = "IN"
    strategy: str = "core"
    thresholds: Optional[ThresholdsBody] = None

@router.post("/discovery/scan/async")
async def trigger_async_scan(
    request: AsyncScanRequest = AsyncScanRequest(),
    current_user = Depends(get_current_user)
):
    """
    Triggers an async market scan. Returns job_id immediately.
    Use /discovery/status/{job_id} to check progress.
    Use /discovery/results/{job_id} to get final results.
    """
    try:
        strategy = _normalize_strategy(request.strategy)
        thresholds = _extract_thresholds_payload(request.thresholds)
        if not is_pro_user(current_user):
            if strategy != "core":
                return _error_response(
                    status_code=status.HTTP_403_FORBIDDEN,
                    code="STRATEGY_LOCKED",
                    message=f"Strategy '{strategy}' is available only on Pro plan.",
                    details={"strategy": strategy},
                )
            if thresholds:
                return _error_response(
                    status_code=status.HTTP_403_FORBIDDEN,
                    code="PRO_REQUIRED",
                    message="Custom thresholds are available only on Pro plan.",
                )
        # Trigger Celery task with strategy/threshold context.
        user_plan = effective_plan(
            getattr(current_user, "plan", "free"),
            getattr(current_user, "plan_expires_at", None),
            getattr(current_user, "email", None),
        )
        task = master_scan_workflow.delay(
            request.region,
            strategy,
            thresholds,
            user_plan,
        )
        
        return {
            "job_id": task.id,
            "status": "queued",
            "strategy": strategy,
            "message": "Scan started. Check /discovery/status/{job_id} for progress."
        }
        
    except Exception as e:
        print(f"Async Scan Trigger Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/discovery/status/{job_id}")
async def get_scan_status(job_id: str, current_user = Depends(get_current_user)):
    """
    Get the current status/progress of an async scan job.
    
    Returns:
        - state: PENDING, PROGRESS, SUCCESS, FAILURE
        - percent: 0-100 progress
        - message: Current status message
    """
    try:
        # Get Celery task result
        task_result = AsyncResult(job_id, app=celery_app)
        
        # Get progress from Redis
        progress = get_scan_progress(job_id)
        
        response = {
            "job_id": job_id,
            "state": task_result.state,
            "percent": 0,
            "progress_pct": 0,
            "message": "Initializing..."
        }
        
        if progress:
            response["percent"] = progress.get("percent", 0)
            response["progress_pct"] = response["percent"]
            response["message"] = progress.get("message", "Processing...")
        
        if task_result.state == "SUCCESS":
            response["percent"] = 100
            response["progress_pct"] = 100
            response["message"] = "Scan complete!"
            response["result_ready"] = True
            
        elif task_result.state == "FAILURE":
            response["percent"] = -1
            response["progress_pct"] = -1
            response["message"] = f"Scan failed: {str(task_result.result)}"
            response["error"] = str(task_result.result)
        
        return response
        
    except Exception as e:
        print(f"Status Check Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/discovery/results/{job_id}")
async def get_async_scan_results(job_id: str, current_user = Depends(get_current_user)):
    """
    Get the final results of a completed async scan.
    Only returns data if the scan is complete.
    """
    try:
        # Check task status first
        task_result = AsyncResult(job_id, app=celery_app)
        
        if task_result.state != "SUCCESS":
            return {
                "job_id": job_id,
                "state": task_result.state,
                "message": "Scan not yet complete. Check /discovery/status/{job_id}",
                "results": None
            }
        
        # Get results from Redis cache
        results = get_scan_results(job_id)
        
        if results:
            celery_result = task_result.result if isinstance(task_result.result, dict) else {}
            strategy_id = _normalize_strategy(celery_result.get("strategy", "core"))
            return {
                "job_id": job_id,
                "state": "SUCCESS",
                "count": len(results),
                "strategy": strategy_id,
                "strategy_metadata": market_scanner.get_strategy_payload(strategy_id),
                "scan_results": results,
                "portfolio_analysis": [],
                "swap_opportunities": []
            }
        
        # Fallback to Celery result
        celery_result = task_result.result
        if celery_result and "results" in celery_result:
            strategy_id = _normalize_strategy(celery_result.get("strategy", "core"))
            return {
                "job_id": job_id,
                "state": "SUCCESS",
                "count": celery_result.get("count", 0),
                "strategy": strategy_id,
                "strategy_metadata": market_scanner.get_strategy_payload(strategy_id),
                "scan_results": celery_result.get("results", []),
                "portfolio_analysis": [],
                "swap_opportunities": []
            }
        
        return {
            "job_id": job_id,
            "state": "SUCCESS",
            "message": "No results found",
            "scan_results": []
        }
        
    except Exception as e:
        print(f"Results Fetch Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
