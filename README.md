# 🚀 AlphaSeeker India

**AI-Powered Quantitative Investment Platform for Indian Markets**

[![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7.svg)](https://render.com)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](https://python.org)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org)

AlphaSeeker is a sophisticated investment analysis platform that combines technical and fundamental analysis with AI-powered insights to identify high-alpha opportunities in the Indian stock market (Nifty 500).

![AlphaSeeker Dashboard](docs/screenshot.png)

---

## ✨ Features

### 📊 Discovery Module
- **Smart Market Scanner** - Scans Nifty 500 stocks using RSI, MACD, momentum, and volume analysis
- **Fundamental Analysis** - Fetches ROE, ROCE, Revenue Growth, Profit Growth, and D/E ratios via Yahoo Finance
- **User-Configurable Thresholds** - Customize technical and fundamental criteria
- **AI Investment Thesis** - Generate investment recommendations using Google Gemini

### 💼 Portfolio Management
- **HDFC Sky Integration** - Sync your HDFC trading account portfolio
- **Portfolio Analytics** - Track holdings, P&L, and allocation
- **Stock Age Tracking** - Monitor holding periods with visual indicators
- **Rebalancing Recommendations** - AI-powered sell/buy swap suggestions

### 🔐 Authentication
- JWT-based secure authentication
- Persistent user sessions
- PostgreSQL database for data persistence

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Discovery  │  │  Portfolio  │  │   Search    │             │
│  │    Page     │  │    Page     │  │    Page     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼────────────────────────────────────┐
│                     Backend (FastAPI)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Scanner    │  │  Portfolio   │  │   Analyst    │          │
│  │   Engine     │  │   Engine     │  │   Engine     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │    Yahoo     │  │    HDFC      │  │   Market     │          │
│  │ Fundamentals │  │   Engine     │  │   Loader     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌──────────┐       ┌──────────┐       ┌──────────┐
   │ Yahoo    │       │ Google   │       │PostgreSQL│
   │ Finance  │       │ Gemini   │       │ Database │
   └──────────┘       └──────────┘       └──────────┘
```

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **FastAPI** | REST API framework |
| **SQLAlchemy** | ORM & database management |
| **PostgreSQL** | Production database |
| **yfinance** | Market data & fundamentals |
| **pandas-ta** | Technical indicators |
| **Google Gemini** | AI model for thesis generation |
| **JWT** | Authentication tokens |

### Frontend
| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework |
| **Vite** | Build tool |
| **Lucide React** | Icons |
| **Chart.js** | Data visualization |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (for production)

### Backend Setup

```bash
# Clone the repository
git clone https://github.com/AbhishekR2030/AIfullstackmanager.git
cd AIfullstackmanager/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run the server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your backend URL

# Run development server
npm run dev
```

---

## 🔐 Environment Variables

### Backend (.env)
```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# AI/LLM
GOOGLE_API_KEY=your_gemini_api_key

# HDFC Integration (Optional)
HDFC_API_KEY=your_hdfc_api_key
HDFC_API_SECRET=your_hdfc_secret

# JWT
SECRET_KEY=your_jwt_secret
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:8000
```

---

## 📁 Project Structure

```
AlphaSeeker/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── routes/              # API endpoints
│   │   │   ├── auth.py
│   │   │   ├── discovery.py
│   │   │   ├── portfolio.py
│   │   │   └── search.py
│   │   └── engines/             # Business logic
│   │       ├── scanner_engine.py      # Market scanning
│   │       ├── portfolio_engine.py    # Portfolio management
│   │       ├── analyst_engine.py      # AI thesis generation
│   │       ├── hdfc_engine.py         # HDFC Sky integration
│   │       ├── yahoo_fundamentals_engine.py  # Fundamental data
│   │       └── market_loader.py       # Data fetching
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/               # Route components
│   │   │   ├── Discovery.jsx
│   │   │   ├── Portfolio.jsx
│   │   │   └── Search.jsx
│   │   ├── components/          # Reusable UI
│   │   │   ├── StockCard.jsx
│   │   │   ├── ThresholdsModal.jsx
│   │   │   └── PortfolioChart.jsx
│   │   └── services/
│   │       └── api.js           # API client
│   ├── package.json
│   └── Dockerfile
├── render.yaml                  # Render deployment config
└── README.md
```

---

## 🔌 API Endpoints

### Discovery
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/discovery/scan` | Run market scan with thresholds |
| GET | `/api/v1/discovery/thesis/{ticker}` | Generate AI thesis |

### Portfolio
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/portfolio/holdings` | Get user holdings |
| POST | `/api/v1/portfolio/sync-hdfc` | Sync HDFC portfolio |
| PUT | `/api/v1/portfolio/item/{id}` | Update holding |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Get JWT token |
| GET | `/api/v1/auth/me` | Get current user |

---

## 🌐 Deployment

This project is configured for deployment on **Render.com** using the `render.yaml` blueprint.

### Services
1. **alphaseeker-frontend** - Static site (React)
2. **alphaseeker-backend** - Web service (FastAPI)
3. **alphaseeker-db** - PostgreSQL database

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

---

## 📊 Scanner Logic

The market scanner uses a multi-stage filtering process:

### Stage 1: Technical Screening
- **Liquidity**: Daily turnover > $1M USD
- **Volatility**: Monthly volatility within configured range
- **Momentum**: Price > SMA(50) and SMA(20)
- **RSI**: Within configured range (default 50-70)
- **Volume Shock**: Current volume > 1.5x average
- **MACD**: Histogram > 0 (bullish)

### Stage 2: Fundamental Screening
- **Revenue Growth**: YoY growth within range
- **ROE**: Return on Equity within range
- **ROCE**: Return on Capital Employed within range
- **Profit Growth**: Earnings growth within range
- **Debt/Equity**: Ratio within range

### Stage 3: AI Analysis
- Top candidates analyzed by Google Gemini
- Investment thesis with bull/bear cases
- Confidence score (0-100)

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Yahoo Finance](https://finance.yahoo.com) for market data
- [Google Gemini](https://ai.google.dev) for AI capabilities
- [Render](https://render.com) for hosting

---

**Built with ❤️ for Indian Investors**
