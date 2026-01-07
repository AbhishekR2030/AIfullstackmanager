
    def delete_trade(self, ticker):
        """
        Deletes a trade by ticker symbol.
        """
        global portfolio_db
        initial_len = len(portfolio_db)
        # Assuming we want to remove all instances of this ticker for now
        # Or remove the first instance? Let's implement removing by ticker
        portfolio_db = [t for t in portfolio_db if t['ticker'] != ticker]
        
        if len(portfolio_db) == initial_len:
             return {"message": "Trade not found", "success": False}
        return {"message": "Trade deleted successfully", "success": True}
