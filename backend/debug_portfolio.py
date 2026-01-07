from app.engines.portfolio_engine import PortfolioEngine
import json

pe = PortfolioEngine()
print("DB Entries:", len(pe.portfolio_db))
print("Raw DB:", json.dumps(pe.portfolio_db[:2], indent=2))

print("Fetching Live Portfolio...")
portfolio = pe.get_portfolio()
print("Enriched Portfolio Count:", len(portfolio))
if portfolio:
    print("Sample:", portfolio[0])
else:
    print("PORTFOLIO IS EMPTY!")
