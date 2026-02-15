"""Legacy helpers for reconstructing portfolio history from in-memory trade data.

This module is not wired into the SQL-backed PortfolioEngine, but it is kept
for local testing and reference workflows.
"""

from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf


def get_portfolio_history_from_trades(portfolio_db, period="1y"):
    """Build a historical portfolio curve from a list of buy trades."""
    if not portfolio_db:
        return {"dates": [], "portfolio_value": [], "invested_value": []}

    tickers = sorted({trade.get("ticker") for trade in portfolio_db if trade.get("ticker")})
    if not tickers:
        return {"dates": [], "portfolio_value": [], "invested_value": []}

    try:
        earliest_date = min(
            datetime.strptime(trade["buy_date"], "%Y-%m-%d")
            for trade in portfolio_db
            if trade.get("buy_date")
        )
    except (KeyError, ValueError):
        return {"error": "Invalid trade date format"}

    try:
        data = yf.download(tickers, start=earliest_date.strftime("%Y-%m-%d"), progress=False)["Close"]
    except Exception:
        return {"error": "Failed to fetch market data"}

    if len(tickers) == 1:
        data = data.to_frame(name=tickers[0])

    data = data.resample("D").ffill()
    history_dates = data.index

    total_value_series = pd.Series(0.0, index=history_dates)
    invested_series = pd.Series(0.0, index=history_dates)

    for trade in portfolio_db:
        ticker = trade.get("ticker")
        try:
            quantity = float(trade.get("quantity", 0))
            buy_price = float(trade.get("buy_price", 0))
            buy_date = pd.to_datetime(trade.get("buy_date"))
        except (TypeError, ValueError):
            continue

        invested_series.loc[buy_date:] += buy_price * quantity

        if ticker in data.columns:
            ticker_value = (data[ticker] * quantity).where(data.index >= buy_date, 0).fillna(0)
            total_value_series = total_value_series.add(ticker_value, fill_value=0)

    end_date = datetime.now()
    if period == "1mo":
        start_filter = end_date - timedelta(days=30)
    elif period == "3mo":
        start_filter = end_date - timedelta(days=90)
    elif period == "6mo":
        start_filter = end_date - timedelta(days=180)
    elif period == "1y":
        start_filter = end_date - timedelta(days=365)
    elif period == "ytd":
        start_filter = datetime(end_date.year, 1, 1)
    else:
        start_filter = earliest_date

    mask = total_value_series.index >= start_filter
    final_values = total_value_series[mask]
    final_invested = invested_series[mask]

    return {
        "dates": final_values.index.strftime("%Y-%m-%d").tolist(),
        "portfolio_value": final_values.round(2).tolist(),
        "invested_value": final_invested.round(2).tolist(),
    }
