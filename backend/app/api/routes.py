
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional
from datetime import timedelta

from app.engines.analyst_engine import AnalystEngine
from app.engines.screener_engine import ScreenerEngine
from app.engines.portfolio_engine import PortfolioEngine
from app.engines.search_engine import SearchEngine
from app.engines.auth_engine import auth_engine, SessionLocal
from app.utils.jwt_handler import create_access_token, get_current_user, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter()

# Instantiate engines
analyst = AnalystEngine()
screener = ScreenerEngine()
portfolio_manager = PortfolioEngine()
search_engine = SearchEngine()

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
