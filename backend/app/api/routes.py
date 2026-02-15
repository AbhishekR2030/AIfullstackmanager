
import os
import requests
import secrets
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import timedelta

from app.engines.analyst_engine import AnalystEngine
from app.engines.screener_engine import ScreenerEngine
from app.engines.portfolio_engine import PortfolioEngine
from app.engines.search_engine import SearchEngine
from app.engines.hdfc_engine import HDFCEngine
from app.engines.auth_engine import auth_engine, SessionLocal
from app.utils.jwt_handler import create_access_token, get_current_user, ACCESS_TOKEN_EXPIRE_MINUTES

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

class GoogleLoginRequest(BaseModel):
    id_token: str

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

# --- Auth Routes ---
@router.post("/auth/signup", response_model=Token)
async def signup(user: UserCreate, db: SessionLocal = Depends(auth_engine.get_db)):
    print(f"Signup request for: {user.email}") # Debug log
    
    db_user = auth_engine.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    auth_engine.create_user(db, email=user.email, password=user.password)
    print("User created in DB.")
    
    # Auto-login after signup
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/auth/google", response_model=Token)
async def login_google(data: GoogleLoginRequest, db: SessionLocal = Depends(auth_engine.get_db)):
    payload, verify_error = _verify_google_id_token(data.id_token)
    if verify_error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=verify_error
        )

    email = payload.get("email")
    user = auth_engine.get_user_by_email(db, email=email)
    if not user:
        # Create user on first Google login
        auth_engine.create_user(db, email=email, password=secrets.token_urlsafe(32))

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/auth/login", response_model=Token)
async def login_json(data: LoginRequest, db: SessionLocal = Depends(auth_engine.get_db)):
    user = auth_engine.get_user_by_email(db, email=data.email)
    
    if not user or not auth_engine.verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/auth/me")
async def read_users_me(current_user = Depends(get_current_user)):
    return {"email": current_user.email, "id": current_user.id}

@router.get("/auth/hdfc/login")
async def hdfc_login(redirect_uri: Optional[str] = None):
    """
    Returns the HDFC login page URL.
    """
    login_url = hdfc_engine.get_login_url(redirect_uri)
    if not login_url:
         raise HTTPException(status_code=500, detail="HDFC configuration missing")
    
    return {"login_url": login_url}

@router.get("/auth/callback")
async def auth_callback(
    code: Optional[str] = None, 
    request_token: Optional[str] = None,
    state: Optional[str] = None,
    app_redirect: Optional[str] = None
):
    """
    Generic callback handler for OAuth flows.
    HDFC returns 'request_token' for v1, 'code' for std oauth.
    """
    token = code or request_token
    
    if token:
           # Attempt exchange
           result = hdfc_engine.exchange_token(token)

           if "error" in result:
                if app_redirect:
                    redirect_url = _build_redirect_url(app_redirect, {
                        "hdfc_status": "error",
                        "error": result.get("error", "Token exchange failed")
                    })
                    return RedirectResponse(url=redirect_url, status_code=302)
                return {"message": "Token exchange failed", "details": result}

           if app_redirect:
                redirect_url = _build_redirect_url(app_redirect, {
                    "hdfc_status": "success"
                })
                return RedirectResponse(url=redirect_url, status_code=302)

           # If successful, we should verify the user and perhaps redirect them back to the frontend
           # For now, simplistic response
           return {"message": "Authorization successful. You can close this window.", "access_token": result.get("access_token")}

    if app_redirect:
        redirect_url = _build_redirect_url(app_redirect, {
            "hdfc_status": "error",
            "error": "No code received"
        })
        return RedirectResponse(url=redirect_url, status_code=302)

    return {"message": "No code received", "params": {"code": code, "request_token": request_token}}

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
    confidence_score: int
    data: Optional[dict] = None

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_stock(request: AnalyzeRequest):
    """
    Generates an investment thesis for a given ticker symbol.
    """
    try:
        # Pass the ticker to the engine 
        # Note: The engine returns a dict, we pass it back directly
        result = analyst.generate_thesis(request.ticker)
        
        if "error" in result:
             raise HTTPException(status_code=500, detail=result["error"])
             
        return result
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
        # Pass user email to engine
        return portfolio_manager.add_trade(request.dict(), current_user.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/portfolio")
async def get_portfolio(current_user = Depends(get_current_user)):
    try:
        return portfolio_manager.get_portfolio(current_user.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/portfolio/sync/hdfc")
async def sync_hdfc_portfolio(current_user = Depends(get_current_user)):
    """
    Fetches latest holdings from HDFC and updates the portfolio.
    """
    try:
        # 1. Fetch from HDFC
        holdings = hdfc_engine.fetch_holdings()
        
        if isinstance(holdings, dict) and "error" in holdings:
             raise HTTPException(status_code=400, detail=holdings["error"])
             
        # 2. Update Portfolio Engine
        result = portfolio_manager.sync_hdfc_trades(holdings, current_user.email)
        
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
        return portfolio_manager.get_portfolio_history(current_user.email, period)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/portfolio/delete/{ticker}")
async def delete_trade(ticker: str, current_user = Depends(get_current_user)):
    try:
        return portfolio_manager.delete_trade(ticker, current_user.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from app.engines.scanner_engine import MarketScanner
from app.engines.rebalancer_engine import RebalancerEngine

market_scanner = MarketScanner()
rebalancer = RebalancerEngine()

# Thresholds Request Model
class ThresholdsBody(BaseModel):
    technical: Optional[dict] = None
    fundamental: Optional[dict] = None

class ScanRequestBody(BaseModel):
    thresholds: Optional[ThresholdsBody] = None

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
        # Extract thresholds from request
        thresholds = None
        if request.thresholds:
            thresholds = {
                "technical": request.thresholds.technical or {},
                "fundamental": request.thresholds.fundamental or {}
            }
        
        # 1. Run Market Scanner with thresholds
        buy_candidates = market_scanner.scan_market(thresholds=thresholds)
        
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
        
        return {
            "scan_results": buy_candidates,
            "portfolio_analysis": analyzed_holdings,
            "swap_opportunities": swap_opportunities
        }

    except Exception as e:
        print(f"Discovery Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

from app.engines.search_engine import SearchEngine
search_engine = SearchEngine()

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

class ScanRequest(BaseModel):
    region: str = "IN"

@router.post("/discovery/scan/async")
async def trigger_async_scan(
    request: ScanRequest = ScanRequest(),
    current_user = Depends(get_current_user)
):
    """
    Triggers an async market scan. Returns job_id immediately.
    Use /discovery/status/{job_id} to check progress.
    Use /discovery/results/{job_id} to get final results.
    """
    try:
        # Trigger Celery task
        task = master_scan_workflow.delay(request.region)
        
        return {
            "job_id": task.id,
            "status": "pending",
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
            "message": "Initializing..."
        }
        
        if progress:
            response["percent"] = progress.get("percent", 0)
            response["message"] = progress.get("message", "Processing...")
        
        if task_result.state == "SUCCESS":
            response["percent"] = 100
            response["message"] = "Scan complete!"
            response["result_ready"] = True
            
        elif task_result.state == "FAILURE":
            response["percent"] = -1
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
            return {
                "job_id": job_id,
                "state": "SUCCESS",
                "count": len(results),
                "scan_results": results,
                "portfolio_analysis": [],
                "swap_opportunities": []
            }
        
        # Fallback to Celery result
        celery_result = task_result.result
        if celery_result and "results" in celery_result:
            return {
                "job_id": job_id,
                "state": "SUCCESS",
                "count": celery_result.get("count", 0),
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
