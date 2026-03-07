# ALPHASEEKER INDIA — Technical Design Document (TDD)
**Version 1.0 | February 2026 | Confidential**

> Architecture, API Design, Database Schema, Strategy Engine & Deployment

---

## Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [Backend Architecture](#2-backend-architecture)
3. [Database Schema](#3-database-schema)
4. [API Contract](#4-api-contract)
5. [Quantitative Strategy Engine Design](#5-quantitative-strategy-engine-design)
6. [Strategy Preset Configurations](#6-strategy-preset-configurations)
7. [AI Analyst Engine](#7-ai-analyst-engine)
8. [Portfolio Intelligence Engine](#8-portfolio-intelligence-engine)
9. [iOS App Architecture](#9-ios-app-architecture)
10. [Freemium Enforcement Architecture](#10-freemium-enforcement-architecture)
11. [Async Processing (Celery + Redis)](#11-async-processing-celery--redis)
12. [Security](#12-security)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Broker Integration Design](#14-broker-integration-design)

---

## 1. System Architecture Overview

Alphaseeker is a multi-tier, cloud-native application with a decoupled frontend and backend. The architecture separates concerns cleanly: a React + Capacitor iOS client, a FastAPI Python REST backend, an asynchronous Celery worker tier for long-running computations, and PostgreSQL + Redis for persistence and caching.

> **Architecture Philosophy:** Every heavy computation (market scanning, AI thesis generation) runs asynchronously outside the HTTP request cycle. The frontend polls for results. This ensures the iOS app is never blocked waiting for a 30–60 second scan to complete.

### 1.1 High-Level Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      iOS CLIENT (Capacitor)                      │
│  React 18 + Vite + React Router 7 + Chart.js + Lucide Icons    │
│  Capacitor Plugins: Google Auth, Browser, Status Bar           │
└───────────────────┬─────────────────────┬────────────────────────┘
                    │ HTTPS REST API       │ Deep Link Callback
┌───────────────────┴─────────────────────┴────────────────────────┐
│                   FastAPI BACKEND (Python 3.11)                  │
│  Auth Engine | Portfolio Engine | Discovery Engine             │
│  Analyst Engine | Rebalancer Engine | Market Loader            │
└──────┬──────────────┬────────────┬────────────┬─────────────────┘
       │              │            │            │
 ┌─────┴──────┐ ┌─────┴────┐ ┌────┴─────┐ ┌───┴──────┐
 │  Celery    │ │PostgreSQL│ │  Redis   │ │  Google  │
 │  Workers  │ │   (DB)   │ │ (Cache)  │ │  Gemini  │
 └────────────┘ └──────────┘ └──────────┘ └──────────┘
  (Scan Jobs)  (Users/Portfolio) (Job State)  (AI API)
```

### 1.2 Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| iOS Client | React + Capacitor | React 18, Cap 8 | Cross-platform mobile app (iOS native shell around web UI) |
| Build Tool | Vite | 5.x | Fast bundling, HMR, production builds |
| Routing | React Router | 7.x | Client-side navigation between screens |
| Charts | Chart.js + react-chartjs-2 | 4.x | Portfolio value history visualisation |
| HTTP Client | Axios | 1.x | API calls with JWT interceptor |
| Backend | FastAPI | 0.110+ | Async REST API, OpenAPI docs auto-generated |
| Python Runtime | Python | 3.11 | Type safety, modern async support |
| ORM | SQLAlchemy | 2.x | Database models, migrations |
| Task Queue | Celery | 5.x | Async market scans and AI jobs |
| Market Data | yfinance | Latest | Yahoo Finance: prices, fundamentals, history |
| Technical Analysis | pandas-ta | Latest | RSI, MACD, SMA, volume indicators |
| AI Engine | Google Gemini API | 2.5-flash | Investment thesis generation |
| Auth | JWT + passlib | PyJWT 2.x | Stateless session tokens, bcrypt hashing |
| Primary DB | PostgreSQL | 15 | Users, portfolios, broker tokens |
| Cache / Queue | Redis | 7.x | Celery broker, scan job state, result cache |
| Deployment: Backend | Render | Docker | Auto-scaling container service |
| Deployment: Frontend | Vercel | Static | CDN-served React build |
| iOS Distribution | Xcode + App Store | Capacitor 8 | Native iOS app packaging |

---

## 2. Backend Architecture

### 2.1 FastAPI Application Structure

```
backend/
  main.py                   # FastAPI app factory, CORS, router registration
  app/
    __init__.py
    api/
      routes.py             # All REST endpoints (refactor to modules in V1.1)
    core/
      celery_app.py         # Celery instance with Redis broker config
    engines/
      auth_engine.py        # User registration, login, JWT generation
      portfolio_engine.py   # Portfolio CRUD, P&L calculation
      portfolio_engine_ext.py # Extended portfolio analytics
      scanner_engine.py     # Hybrid strategy orchestration (CORE ENGINE)
      analyst_engine.py     # Gemini AI thesis generation
      rebalancer_engine.py  # Sell/Hold ranking, swap recommendations
      market_loader.py      # Nifty 500 + US ticker universe management
      hdfc_engine.py        # HDFC broker OAuth + portfolio sync
      yahoo_fundamentals_engine.py  # Fundamental data fetching
      search_engine.py      # Ticker / company name search
      screener_engine.py    # Legacy simple screener (to be deprecated)
      fmp_engine.py         # Financial Modeling Prep (optional premium data)
    workers/
      tasks.py              # Celery task definitions (async scan jobs)
    utils/
      jwt_utils.py          # Token encode/decode helpers
      ticker_utils.py       # NSE/BSE ticker normalisation helpers
```

> **V1.1 Refactor Note:** `routes.py` is currently a single large file. In V1.1, split into: `auth_routes.py`, `portfolio_routes.py`, `discovery_routes.py`, `analysis_routes.py`. Each should be an `APIRouter` mounted in `main.py`.

### 2.2 Request Lifecycle

1. iOS app sends HTTPS request with `Authorization: Bearer <JWT>` header
2. FastAPI dependency `get_current_user()` validates JWT, extracts user email
3. Route handler calls appropriate Engine function
4. For **sync** operations: engine returns result directly, response sent
5. For **async scans**: Celery task submitted, `job_id` returned immediately
6. iOS polls `GET /discovery/status/{job_id}` every 2 seconds
7. When complete: iOS fetches `GET /discovery/results/{job_id}`

### 2.3 Engine Design Patterns

- **Pure functions** or thin class wrappers. No shared global state between requests.
- All database access via SQLAlchemy Session passed as parameter (dependency injection).
- External API calls (Yahoo Finance, Gemini) wrapped in `try/except` with structured error returns.
- Return types are Python dicts (JSON-serialisable). No ORM objects returned directly to routes.
- Logging via Python standard `logging` module with structured messages.

---

## 3. Database Schema

### 3.1 Full Schema (V1.0)

```sql
-- Users table
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),           -- NULL for OAuth-only accounts
  google_id       VARCHAR(255),            -- Google OAuth sub claim
  is_active       BOOLEAN DEFAULT TRUE,
  plan            VARCHAR(20) DEFAULT 'free', -- 'free' | 'pro'
  plan_expires_at TIMESTAMP,              -- NULL = free forever
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Portfolio holdings
CREATE TABLE portfolio_items (
  id           SERIAL PRIMARY KEY,
  user_email   VARCHAR(255) NOT NULL REFERENCES users(email),
  ticker       VARCHAR(20) NOT NULL,      -- e.g. TCS.NS
  company_name VARCHAR(255),
  quantity     FLOAT NOT NULL,
  buy_price    FLOAT NOT NULL,
  buy_date     VARCHAR(20),               -- YYYY-MM-DD
  source       VARCHAR(20) DEFAULT 'MANUAL', -- MANUAL | HDFC | ZERODHA | GROWW
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Broker OAuth tokens
CREATE TABLE broker_tokens (
  id            SERIAL PRIMARY KEY,
  user_email    VARCHAR(255) NOT NULL REFERENCES users(email),
  broker        VARCHAR(20) NOT NULL,     -- HDFC | ZERODHA | GROWW | ANGEL
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- AI Thesis cache (avoid redundant Gemini calls)
CREATE TABLE thesis_cache (
  id           SERIAL PRIMARY KEY,
  ticker       VARCHAR(20) NOT NULL,
  thesis_json  TEXT NOT NULL,             -- Full JSON thesis
  model_used   VARCHAR(50),
  generated_at TIMESTAMP DEFAULT NOW(),
  expires_at   TIMESTAMP                  -- Invalidate after 6 hours
);

-- Daily usage tracking (freemium limits)
CREATE TABLE usage_log (
  id         SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email),
  action     VARCHAR(50) NOT NULL,        -- 'scan' | 'thesis' | 'export'
  date       DATE DEFAULT CURRENT_DATE,
  count      INTEGER DEFAULT 1
);
```

### 3.2 Indexes

```sql
CREATE INDEX idx_portfolio_user ON portfolio_items(user_email);
CREATE INDEX idx_broker_tokens_user ON broker_tokens(user_email);
CREATE INDEX idx_thesis_cache_ticker ON thesis_cache(ticker);
CREATE INDEX idx_usage_log_user_date ON usage_log(user_email, date);
```

---

## 4. API Contract

All endpoints prefixed with `/api/v1`. Authentication uses `Bearer JWT` unless noted. All responses return JSON.

### 4.1 Auth Endpoints

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/auth/signup` | None | `email, password` | `{ token, user }` |
| POST | `/auth/login` | None | `email, password` | `{ token, user }` |
| POST | `/auth/google` | None | `google_token` | `{ token, user }` |
| GET | `/auth/me` | JWT | — | `{ email, plan, plan_expires_at }` |
| GET | `/auth/hdfc/login` | JWT | — | `{ redirect_url }` |
| GET | `/auth/callback` | None | `code` (query param) | Redirects to app deep link |
| POST | `/auth/logout` | JWT | — | `{ success: true }` |
| DELETE | `/auth/account` | JWT | — | `{ success: true }` |

### 4.2 Discovery Endpoints

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| POST | `/discovery/scan` | Free (limited) / Pro | Sync scan. Body: `{ strategy, thresholds }`. Returns ranked stock list. |
| POST | `/discovery/scan/async` | Pro | Async scan. Returns `{ job_id }`. Poll status endpoint. |
| GET | `/discovery/status/{job_id}` | JWT | Returns `{ status, progress_pct, stocks_processed }`. |
| GET | `/discovery/results/{job_id}` | JWT | Returns `{ results: [ StockCard[] ] }` when complete. |
| DELETE | `/discovery/cancel/{job_id}` | JWT | Cancel an in-progress async scan. |

> **Freemium Gating:** `POST /discovery/scan` checks plan in JWT. Free users: strategy must be `core`, results capped at 10. Pro users: all strategies, unlimited results. Gating logic lives in `routes.py`, not the engine (engines are plan-agnostic).

### 4.3 Portfolio Endpoints

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| GET | `/portfolio` | JWT | Returns full portfolio with live prices, P&L per holding, total metrics. |
| POST | `/portfolio/add` | Free (≤10) / Pro | Add trade. Body: `{ ticker, quantity, buy_price, buy_date }`. |
| DELETE | `/portfolio/delete/{ticker}` | JWT | Remove holding by ticker. |
| POST | `/portfolio/sync/hdfc` | Pro | Re-sync from HDFC broker. Returns `{ added, updated, removed }` counts. |
| POST | `/portfolio/sync/zerodha` | Pro | Sync from Zerodha Kite (V1.1). |
| POST | `/portfolio/sync/groww` | Pro | Sync from Groww (V1.2). |
| GET | `/portfolio/history` | JWT (Free: 1M only) | Portfolio value over time. Query: `period=1w\|1m\|3m\|6m\|1y\|ytd\|all`. |
| GET | `/portfolio/rebalance` | Pro | Returns `sell_candidates[]` and `buy_recommendations[]` with swap pairs. |
| GET | `/portfolio/sell-ranking` | Pro | Returns holdings sorted by Sell Urgency score descending. |

### 4.4 Analysis Endpoints

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| POST | `/analyze` | Free (3/day) / Pro unlimited | Generate AI thesis. Body: `{ ticker }`. Returns full ThesisObject. |
| GET | `/analyze/cached/{ticker}` | JWT | Return cached thesis if available (no new Gemini call). |
| GET | `/search` | Free | Search stocks. Query: `q=<name or ticker>`. Returns `[{ ticker, name, exchange }]`. |

---

## 5. Quantitative Strategy Engine Design

The strategy engine follows a **hybrid architecture**:
- **Shared platform layers** enforce data quality, risk controls, execution simulation, portfolio accounting, and monitoring.
- **Strategy-specific alpha pipelines** implement independent features, filters, scoring, and ranking logic.

This mirrors institutional design patterns where risk/compliance and execution are centralized, while alpha research and signal generation remain strategy-specific.

### 5.1 Shared Platform Layers (Common Services)

All strategies call these common services:
- `DataPlatformService`: universe loading, OHLCV/fundamental ingestion, cache orchestration, symbol normalization.
- `RiskGuardService`: hard liquidity checks, tradability checks, concentration caps, configurable kill-switch conditions.
- `ExecutionSimulationService`: slippage and fill assumptions for opportunity ranking realism.
- `PortfolioAccountingService`: position impact, turnover cost, exposure deltas, replacement feasibility.
- `MonitoringService`: latency, candidate counts, rejection reasons, data quality and drift metrics.

These services are mandatory and strategy-agnostic.

### 5.2 Strategy Pipeline Contract

Each strategy implements the same interface but not the same internal stages:

```python
class StrategyPipeline(Protocol):
    strategy_id: str

    def build_features(self, market_data, fundamentals, context) -> pd.DataFrame:
        ...

    def filter_candidates(self, features: pd.DataFrame, context) -> pd.DataFrame:
        ...

    def score_candidates(self, features: pd.DataFrame, context) -> pd.DataFrame:
        ...

    def generate_rationales(self, scored: pd.DataFrame, context) -> list[dict]:
        ...
```

The orchestrator composes common services + selected strategy pipeline:

```python
def run_scan(strategy_id, user_context, threshold_overrides=None):
    strategy = strategy_registry.get(strategy_id)
    universe = data_platform.load_universe(user_context.region)
    market_data = data_platform.fetch_market_data(universe)
    fundamentals = data_platform.fetch_fundamentals(universe)

    features = strategy.build_features(market_data, fundamentals, user_context)
    filtered = strategy.filter_candidates(features, user_context)
    scored = strategy.score_candidates(filtered, user_context)

    risk_passed = risk_guard.apply_post_score_checks(scored, user_context)
    executable = execution_simulator.apply_tradeability_model(risk_passed, user_context)
    ranked = portfolio_accounting.attach_portfolio_context(executable, user_context.portfolio)

    return strategy.generate_rationales(ranked, user_context)
```

### 5.3 Strategy-Specific Alpha Pipelines

#### 5.3.1 Citadel Momentum
- Feature set: 12-1 momentum, volume shock persistence, RSI trend slope, breakout persistence.
- Filters: high-liquidity momentum continuation filters.
- Scoring: momentum-dominant weighted score.

#### 5.3.2 Jane Street Statistical
- Feature set: spread dislocation proxies, sector-relative RSI, short-horizon reversal stability.
- Filters: mean-reversion setup validation, volatility constraints for reversal quality.
- Scoring: statistical edge and reversion confidence.

#### 5.3.3 Millennium Quality
- Feature set: ROE/ROCE stability, earnings quality, leverage discipline, drawdown resilience.
- Filters: hard quality and balance-sheet filters.
- Scoring: quality-dominant composite.

#### 5.3.4 DE Shaw Multi-Factor
- Feature set: momentum + quality + valuation + low-volatility blend.
- Filters: multi-factor consistency checks.
- Scoring: balanced factor blend with low-volatility tilt.

#### 5.3.5 Alphaseeker Core
- Feature set: broad momentum + quality baseline with conservative constraints.
- Filters: free-tier safe defaults for explainability.
- Scoring: balanced baseline conviction score.

### 5.4 Scoring Normalization and Output Contract

Because each strategy has independent scoring logic, all outputs are normalized to a platform contract:
- `conviction_score`: float in [0, 100]
- `strategy_signal`: strategy-specific rationale payload
- `risk_flags`: common risk warning set
- `execution_feasibility`: simulated liquidity/slippage readiness

Normalization enables UI comparability without forcing identical strategy internals.

### 5.5 Rebalance Integration

Rebalancer consumes strategy-ranked opportunities plus current holdings:
- maps sell candidates to top executable buy candidates
- attaches switch rationale with strategy-specific explanation + shared risk commentary
- surfaces expected turnover cost and confidence metadata

---

## 6. Strategy Preset Configurations

Each preset is represented by a **StrategySpec** entry in a strategy registry. A preset maps to a concrete strategy pipeline class plus optional default parameters.

### 6.1 Strategy Registry Model

```python
@dataclass(frozen=True)
class StrategySpec:
    id: str
    label: str
    tier: Literal["free", "pro"]
    academic_basis: str
    factor_focus: str
    pipeline_class: type[StrategyPipeline]
    default_params: dict[str, Any]
    supports_custom_thresholds: bool = False
```

### 6.2 Preset Mapping

| Strategy ID | Pipeline Class | Tier | Notes |
|-------------|----------------|------|-------|
| `core` | `CorePipeline` | Free | Baseline balanced strategy |
| `citadel_momentum` | `MomentumPipeline` | Pro | Momentum continuation |
| `jane_street_stat` | `StatArbPipeline` | Pro | Statistical mean-reversion |
| `millennium_quality` | `QualityPipeline` | Pro | Quality-first selection |
| `de_shaw_multifactor` | `MultiFactorPipeline` | Pro | Momentum+quality+valuation |
| `custom` | `CustomPipeline` | Pro | User-owned parameter profile |

### 6.3 Custom Thresholds

`custom` strategy accepts explicit threshold overrides and model knobs.  
Non-custom strategies may accept bounded tuning, but preserve strategy identity (no full mutation into another strategy).

### 6.4 Versioning and Backtests

- Every strategy run stores `{strategy_id, strategy_version, parameter_hash}`.
- Backtests and live scans are reproducible across deployments.
- Strategy upgrades use semantic versioning and migration notes.

---

## 7. AI Analyst Engine

### 7.1 Gemini Prompt Design

```python
ANALYST_PROMPT = """
You are a senior equity research analyst at a top-tier investment bank.
Analyse the following stock data for {ticker} ({company_name}) and provide
a structured investment thesis.

STOCK DATA:
- Current Price: Rs. {price}
- RSI (14): {rsi}
- MACD Histogram: {macd_hist}
- Return on Equity: {roe}%
- Revenue Growth (YoY): {rev_growth}%
- Debt/Equity Ratio: {debt_eq}
- Upside Score: {upside_score}/100
- Sector: {sector}
- Market Cap: Rs. {mktcap} Cr

Return ONLY valid JSON in this exact format:
{
  "recommendation": "BUY" | "HOLD" | "SELL",
  "confidence": <integer 0-100>,
  "summary": "<2-3 sentence investment case>",
  "bull_case": ["<driver 1>", "<driver 2>", "<driver 3>"],
  "bear_case": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "target_horizon": "<3-12 months>"
}
"""
```

### 7.2 Model Fallback Chain

```python
GEMINI_MODELS = [
    'gemini-2.5-flash',         # Primary: best quality
    'gemini-2.5-flash-lite',    # Fallback 1: higher rate limit
    'gemini-2.0-flash',         # Fallback 2: legacy stable
]

def generate_thesis(prompt, blacklist):
    for model in GEMINI_MODELS:
        if model in blacklist:
            continue
        try:
            response = call_gemini(model, prompt)
            return parse_json_thesis(response), model
        except RateLimitError:
            blacklist_model(model, cooldown_minutes=15)
        except Exception as e:
            log.warning(f'Model {model} failed: {e}')
    return None, None  # All models failed
```

### 7.3 Thesis Caching
- Generated theses cached in `thesis_cache` table for **6 hours**
- Cache key: ticker + date (not time). Same-day requests reuse cache.
- Pro users can force refresh via query param: `?force_refresh=true`
- Free users always receive cached thesis if available (no API call counted against quota)

---

## 8. Portfolio Intelligence Engine

### 8.1 Sell Urgency Score Computation

```python
def compute_sell_urgency(holding, market_data, top_scan_score):
    score = 0

    # Signal 1: Momentum Deterioration (25%)
    rsi = market_data['rsi']
    macd_hist = market_data['macd_hist']
    if rsi < 35:
        score += 25    # Strong bearish RSI
    elif rsi < 45:
        score += 15    # Weakening
    if macd_hist < 0:
        score += 10    # Bearish MACD (capped at 25 total for signal 1)

    # Signal 2: Better Opportunity (30%)
    holding_score = market_data.get('upside_score', 50)
    opportunity_gap = top_scan_score - holding_score
    if opportunity_gap >= 25:
        score += 30
    elif opportunity_gap >= 15:
        score += 18
    elif opportunity_gap >= 8:
        score += 8

    # Signal 3: Fundamental Weakening (25%)
    roe_current = market_data.get('roe', 100)
    roe_prev    = holding.get('roe_at_purchase', roe_current)
    if roe_prev > 0 and (roe_prev - roe_current) / roe_prev > 0.20:
        score += 20    # ROE dropped > 20%
    rev_growth = market_data.get('rev_growth', 10)
    if rev_growth < 0:
        score += 15    # Revenue contraction

    # Signal 4: Stop-Loss Trigger (20%)
    current_price = market_data['current_price']
    buy_price     = holding['buy_price']
    drawdown      = (buy_price - current_price) / buy_price
    if drawdown >= 0.15:
        score += 20    # Hard stop: -15% from buy price
    elif drawdown >= 0.08:
        score += 12    # Warning zone

    return min(100, round(score))
```

### 8.2 Sell Urgency Badges

| Score Range | Badge | Colour | Meaning |
|-------------|-------|--------|---------|
| 70–100 | SELL | 🔴 Red | Multiple signals breached. Exit recommended. |
| 45–69 | REVIEW | 🟠 Orange | At least one major signal triggered. Monitor closely. |
| 20–44 | WATCH | 🟡 Yellow | Minor signals. No immediate action needed. |
| 0–19 | HOLD | 🟢 Green | Position healthy. No action needed. |

---

## 9. iOS App Architecture

### 9.1 Screen Map

```
App
├── /login                   Login.jsx      (Public)
├── /dashboard               Dashboard.jsx  (Protected)
│   ├── Portfolio summary widget
│   ├── P&L chart (Chart.js)
│   └── Quick actions: Scan / Add Trade
├── /discovery               Discovery.jsx  (Protected)
│   ├── Strategy selector (presets grid)
│   ├── Threshold config modal (Pro only)
│   ├── Scan progress bar
│   └── Results: StockCard list
├── /portfolio               Portfolio.jsx  (Protected)
│   ├── Holdings list with sell badges
│   ├── Add Trade modal
│   ├── Broker sync panel
│   └── Rebalance tab (Pro only)
└── /settings                Settings.jsx   (Protected - V1.1)
    ├── Plan & subscription
    ├── Connected brokers
    └── Account management
```

### 9.2 State Management
- **Auth state:** JWT stored in `localStorage` (web) and Capacitor Preferences (iOS native)
- **Portfolio state:** `portfolioStore.js` with in-memory cache, event emitter pattern for cross-component updates
- **Scan state:** Local component state in `Discovery.jsx` with polling interval
- No external state library (Redux, Zustand) — custom lightweight pattern

> **V1.1 Upgrade Note:** As the app grows beyond 4 screens, migrate to **Zustand** for global state management. The `portfolioStore.js` event emitter pattern will not scale to 8+ screens cleanly.

### 9.3 API Service Layer

```javascript
// src/services/api.js
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

// JWT interceptor: auto-attach token to every request
api.interceptors.request.use(config => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(null, error => {
  if (error.response?.status === 401) clearAuthAndRedirect();
  return Promise.reject(error);
});
```

### 9.4 Deep Linking (HDFC Callback)
- iOS custom URL scheme: `com.alphaseeker.india://auth/callback`
- HDFC OAuth redirect caught by AppDelegate (Capacitor handles via App plugin)
- `hdfcCallbackStorage.js` stores the pending callback state across the OAuth browser redirect
- `Login.jsx` listens for deep link events and processes the auth code

---

## 10. Freemium Enforcement Architecture

### 10.1 Plan Check Flow

```python
# In routes.py, for every gated endpoint:
def require_pro(current_user=Depends(get_current_user), db=Depends(get_db)):
    if current_user.plan != 'pro':
        raise HTTPException(status_code=403,
            detail={'code': 'PRO_REQUIRED',
                    'message': 'This feature requires Alphaseeker Pro.',
                    'upgrade_url': '/upgrade'})
    if current_user.plan_expires_at and current_user.plan_expires_at < datetime.now():
        # Downgrade expired pro user
        current_user.plan = 'free'
        db.commit()
        raise HTTPException(status_code=403, detail={'code': 'PRO_EXPIRED'})

def check_daily_limit(user_email, action, limit, db):
    today_count = db.query(UsageLog).filter(
        UsageLog.user_email == user_email,
        UsageLog.action == action,
        UsageLog.date == date.today()
    ).scalar() or 0
    if today_count >= limit:
        raise HTTPException(status_code=429,
            detail={'code': 'DAILY_LIMIT',
                    'message': f'Daily {action} limit of {limit} reached.',
                    'reset_at': 'midnight IST'})
    # Increment counter
    db.execute(insert_or_increment_usage(user_email, action))
```

### 10.2 Frontend Paywall Handling
- All `403 PRO_REQUIRED` responses trigger an `UpgradeModal` component
- `UpgradeModal` shows feature list, pricing (Rs. 499/mo or Rs. 3,999/yr), and CTA button
- In V1.0, CTA links to external payment page (Razorpay or Stripe). Native in-app purchase in V1.1.

---

## 11. Async Processing (Celery + Redis)

### 11.1 Scan Job Lifecycle

```python
# workers/tasks.py
@celery_app.task(bind=True, time_limit=300)  # 5 min max
def run_market_scan(self, job_id, strategy_config, user_email):
    redis.set(f'scan:{job_id}:status', 'running')
    redis.set(f'scan:{job_id}:progress', 0)

    universe = load_nifty500_tickers()
    total    = len(universe)
    passed   = []

    for i, ticker in enumerate(universe):
        result = screen_ticker(ticker, strategy_config)
        if result:
            passed.append(result)
        # Update progress every 10 tickers
        if i % 10 == 0:
            pct = int((i / total) * 100)
            redis.set(f'scan:{job_id}:progress', pct)

    # Sort by upside score
    passed.sort(key=lambda x: x['upside_score'], reverse=True)

    redis.set(f'scan:{job_id}:status', 'complete')
    redis.set(f'scan:{job_id}:results', json.dumps(passed), ex=14400)  # 4hr TTL
    return job_id
```

---

## 12. Security

### 12.1 Authentication
- Passwords hashed with bcrypt (passlib, 12 rounds)
- JWTs signed with HS256, 7-day expiry, `SECRET_KEY` from environment
- Google ID tokens verified against Google's public key endpoint
- HDFC tokens stored encrypted in `broker_tokens` table (AES-256 — V1.1)

### 12.2 API Security
- All endpoints require JWT except `/auth/signup`, `/auth/login`, `/auth/google`, `/auth/callback`
- CORS: only Vercel production domain and `localhost:3000` allowed
- Rate limiting: `slowapi` middleware, 100 req/min per IP
- SQL injection prevention: all queries via SQLAlchemy parameterised statements
- Input validation: Pydantic models on all request bodies

### 12.3 iOS App Security
- JWT stored in Capacitor Preferences (iOS Keychain-backed on device)
- No sensitive data in `localStorage` on native builds
- Certificate pinning: recommended for V1.1 before scaling
- **Sign in with Apple:** required by Apple guidelines when Google Sign-In is offered

---

## 13. Deployment Architecture

### 13.1 render.yaml Services

```yaml
services:
  - name: alphaseeker-backend
    type: web
    runtime: docker
    dockerfilePath: backend/Dockerfile
    healthCheckPath: /
    envVars:
      - DATABASE_URL, GOOGLE_API_KEY, REDIS_URL, SECRET_KEY, HDFC_*, GOOGLE_*

  - name: alphaseeker-celery-worker
    type: worker
    runtime: docker
    dockerfilePath: backend/Dockerfile.worker

  - name: alphaseeker-db
    type: pserv          # Render PostgreSQL
    plan: free

  - name: alphaseeker-redis
    type: redis
    plan: free
```

### 13.2 Scaling Plan

| Stage | MAU | Backend | DB | Redis | Est. Monthly Cost |
|-------|-----|---------|-----|-------|-------------------|
| Launch | < 1,000 | Render Starter (1 instance) | Free (1GB) | Free (25MB) | ~$14 USD |
| Growth | 1K–10K | Render Standard (2 instances) | Starter ($7) | Starter ($10) | ~$50 USD |
| Scale | 10K–50K | Render Pro (3 instances + auto-scale) | Standard ($25) | Standard ($15) | ~$150 USD |

### 13.3 Environment Variables

```env
# Backend (Render environment)
DATABASE_URL=postgresql://...
REDIS_URL=rediss://...
SECRET_KEY=<256-bit-random-hex>
GOOGLE_API_KEY=<gemini-api-key>
GOOGLE_CLIENT_ID=<web-oauth-client-id>
GOOGLE_IOS_CLIENT_ID=<ios-oauth-client-id>
GOOGLE_SERVER_CLIENT_ID=<server-client-id>
HDFC_API_KEY=<hdfc-key>
HDFC_API_SECRET=<hdfc-secret>
HDFC_APP_REDIRECT_URI=com.alphaseeker.india://auth/callback

# Frontend (.env.production)
VITE_API_URL=https://alphaseeker-backend.onrender.com/api/v1
VITE_GOOGLE_CLIENT_ID=<same-as-above>
```

---

## 14. Broker Integration Design

### 14.1 HDFC Sky (Live ✅)
- OAuth 2.0 Authorization Code flow
- Deep link callback: `com.alphaseeker.india://auth/callback`
- Token refresh: access token valid 24 hours, refresh token 30 days

### 14.2 Zerodha Kite (V1.1)
- Kite Connect API v3: OAuth 2.0 flow, request token exchanged for access token
- Holdings endpoint: `GET /portfolio/holdings` → `{ quantity, average_price, last_price }`
- Env vars: `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`
- Access token valid until 6 AM next day (Zerodha limitation) — re-auth daily

### 14.3 Groww (V1.2)
- Groww developer API (beta) — monitor availability
- Fallback if API not available: CSV export import

### 14.4 Angel One (V1.2)
- Angel Broking SmartAPI: OAuth + TOTP-based 2FA
- Holdings: `GET /portfolio/getAllHolding`
- Requires TOTP secret from user during setup — store encrypted

### 14.5 Paytm Money (V1.2)
- Paytm Money Open API: OAuth 2.0
- Holdings: `GET /v1/holdings`

---

*Alphaseeker India | Version 1.0 | February 2026 | Confidential & Proprietary*
