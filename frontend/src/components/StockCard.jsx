import React from 'react';
import { ArrowUpRight, Activity } from 'lucide-react';
import './StockCard.css';

const StockCard = ({ stock, onClick }) => {
    return (
        <div className="card stock-card" onClick={() => onClick(stock)}>
            <div className="stock-header">
                <div className="stock-ticker">{stock.ticker.replace('.NS', '')}</div>
                <div className="stock-price">₹{stock.price}</div>
            </div>

            <div className="stock-metrics">
                <div className="metric">
                    <span className="label">SMA 20</span>
                    <span className="value">₹{stock.sma_20}</span>
                </div>
                <div className="metric">
                    <span className="label">Momentum</span>
                    <span className={`value ${stock.momentum_score > 0 ? 'text-success' : 'text-danger'}`}>
                        {stock.momentum_score}%
                    </span>
                </div>
            </div>

            <div className="stock-action">
                <button className="btn btn-sm btn-outline">
                    <Activity size={16} style={{ marginRight: '6px' }} />
                    Generate Thesis
                </button>
            </div>
        </div>
    );
};

export default StockCard;
