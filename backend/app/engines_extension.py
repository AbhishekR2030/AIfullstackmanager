"""Legacy in-memory engine helpers."""


def delete_trade_by_ticker(portfolio_db, ticker):
    """Delete all matching ticker entries from an in-memory portfolio list."""
    initial_len = len(portfolio_db)
    filtered = [trade for trade in portfolio_db if trade.get("ticker") != ticker]

    if len(filtered) == initial_len:
        return {
            "message": "Trade not found",
            "success": False,
            "portfolio_db": portfolio_db,
        }

    return {
        "message": "Trade deleted successfully",
        "success": True,
        "portfolio_db": filtered,
    }
