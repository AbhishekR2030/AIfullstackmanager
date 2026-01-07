import React from 'react';
import { ArrowUpRight, Activity } from 'lucide-react';
import './StockCard.css';

const StockCard = ({ stock, onClick }) => {
    return (
        <div className="card stock-card">
            <div className="stock-header">
                <div className="stock-ticker">{stock.ticker.replace('.NS', '')}</div>
                <div className="stock-price">₹{stock.price}</div>
            </div>

            <div className="stock-metrics">
                <div className="metric">
                    <span className="label">Momentum Score</span>
                    <span className="value text-primary">
                        {(stock.volume_shock || stock.momentum_score || 0).toFixed(2)}x
                    </span>
                </div>
                <div className="metric">
                    <span className="label">Proj. Upside (30d)</span>
                    <span className="value text-success">
                        +{((stock.volatility || 0) * 10).toFixed(1)}%
                    </span>
                </div>
            </div>


        </div>
    );
};

export default StockCard;
