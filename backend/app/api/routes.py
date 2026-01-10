
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
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
    state: Optional[str] = None
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
                return {"message": "Token exchange failed", "details": result}
           
           # If successful, we should verify the user and perhaps redirect them back to the frontend
           # For now, simplistic response
           return {"message": "Authorization successful. You can close this window.", "access_token": result.get("access_token")}
           
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

@router.get("/discovery/scan")
async def scan_opportunities(current_user = Depends(get_current_user)):
    """
    Scans for new buy opportunities and rebalancing candidates.
    """
    try:
        # 1. Run Market Scanner
        buy_candidates = market_scanner.scan_market()
        
        # 2. Analyze Portfolio (Rebalancer)
        user_portfolio = portfolio_manager.get_portfolio(current_user.email)
        analyzed_holdings = rebalancer.analyze_portfolio(user_portfolio)
        
        # --- Generate Thesis for Top Pick (AUTO) ---
        if buy_candidates:
            top_pick = buy_candidates[0]
            # Check if thesis already exists or generate it
            if "thesis" not in top_pick:
                print(f"Generating Investment Thesis for Top Pick: {top_pick['ticker']}...")
                try:
                    # This call uses Gemini 2.0 Flash (Fast)
                    analysis = analyst.generate_thesis(top_pick['ticker'])
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
        # Sort potential sells by worst performance first? Or just weakest trend.
        for asset in analyzed_holdings:
            if asset['recommendation'] == 'SELL_CANDIDATE':
                recommendations['sell_candidates'].append(asset)
            else:
                recommendations['keepers'].append(asset)
                
        # If we have sell candidates and buy candidates, create specific swap suggestions
        swap_opportunities = []
        if recommendations['sell_candidates'] and buy_candidates:
            # We pair the WORST asset (highest negative returns / broken trend) 
            # with the BEST buy candidate (highest score).
            
            # Sort Sells: Weakest first (lowest pl_percent)
            sorted_sells = sorted(recommendations['sell_candidates'], key=lambda x: x['pl_percent'])
            
            # Top Buy is already sorted by Score
            top_buy = buy_candidates[0]
            
            for index, sell in enumerate(sorted_sells):
                swap_opportunities.append({
                    "priority": index + 1,
                    "sell": sell['ticker'],
                    "buy": top_buy['ticker'],
                    "reason": f"Sell weak {sell['ticker']} (Trend {sell['trend']}, Returns {sell['pl_percent']}%) to buy strong {top_buy['ticker']} (Momentum Score {top_buy['score']})"
                })
        
        return {
            "scan_results": buy_candidates,
            "portfolio_analysis": analyzed_holdings,
            "swap_opportunities": swap_opportunities
        }

    except Exception as e:
        print(f"Discovery Error: {e}")
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
