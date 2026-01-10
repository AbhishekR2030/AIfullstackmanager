import React from 'react';
import { ArrowUpRight, Activity } from 'lucide-react';
import './StockCard.css';

const StockCard = ({ stock, onClick }) => {
    const [showThesis, setShowThesis] = React.useState(false);

    return (
        <div className="card stock-card">
            <div className="stock-header">
                <div>
                    <div className="stock-ticker">{stock.ticker.replace('.NS', '')}</div>
                    <div className="text-xs text-muted">{stock.sector}</div>
                </div>
                <div className="text-right">
                    <div className="stock-price">₹{stock.price}</div>
                    <div className="text-xs text-success font-bold">Score: {stock.score}</div>
                </div>
            </div>

            <div className="stock-metrics">
                <div className="metric">
                    <span className="label">Momentum</span>
                    <span className="value text-primary">
                        {stock.momentum_score ? stock.momentum_score.toFixed(1) : 'N/A'}
                    </span>
                </div>
                <div className="metric">
                    <span className="label">Upside</span>
                    <span className="value text-success">
                        +{stock.upside_potential ? stock.upside_potential.toFixed(1) : 0}%
                    </span>
                </div>
                <div className="metric">
                    <span className="label">RSI</span>
                    <span className="value text-warning">
                        {stock.rsi ? stock.rsi.toFixed(1) : 0}
                    </span>
                </div>
            </div>

            {/* Thesis Section (Only if available) */}
            {stock.thesis && stock.thesis.length > 0 && (
                <div className="thesis-preview mt-3 pt-2 border-top">
                    <div
                        className="d-flex justify-content-between align-items-center cursor-pointer"
                        onClick={() => setShowThesis(!showThesis)}
                    >
                        <span className="text-xs font-bold text-info">Why Buy?</span>
                        <ArrowUpRight size={14} className={`transform transition ${showThesis ? 'rotate-180' : ''}`} />
                    </div>

                    {showThesis ? (
                        <ul className="text-xs text-muted pl-4 mt-2 mb-0">
                            {stock.thesis.map((pt, i) => <li key={i}>{pt}</li>)}
                        </ul>
                    ) : (
                        <p className="text-xs text-muted mt-1 mb-0 truncate">
                            {stock.thesis[0]}...
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default StockCard;
