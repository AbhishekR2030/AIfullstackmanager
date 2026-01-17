import React from 'react';
import { ArrowUpRight, Activity, TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import './StockCard.css';

const StockCard = ({ stock, onClick, thresholds }) => {
    const [showDetails, setShowDetails] = React.useState(false);

    // Default thresholds if not provided
    const fundThresholds = thresholds?.fundamental || {
        revenue_growth_min: 10,
        revenue_growth_max: 100,
        profit_growth_min: 10,
        profit_growth_max: 100,
        roe_min: 12,
        roe_max: 100,
        roce_min: 12,
        roce_max: 100,
        debt_equity_min: 0,
        debt_equity_max: 100
    };

    // Check if a metric is within threshold range
    const isInRange = (value, min, max) => {
        return value >= min && value <= max;
    };

    // Get metric status (pass/fail/neutral)
    const getMetricStatus = (value, metricType) => {
        if (value === undefined || value === null) return 'neutral';

        switch (metricType) {
            case 'revenue_growth':
                return isInRange(value, fundThresholds.revenue_growth_min, fundThresholds.revenue_growth_max) ? 'pass' : 'fail';
            case 'profit_growth':
                return isInRange(value, fundThresholds.profit_growth_min, fundThresholds.profit_growth_max) ? 'pass' : 'fail';
            case 'roe':
                return isInRange(value, fundThresholds.roe_min, fundThresholds.roe_max) ? 'pass' : 'fail';
            case 'roce':
                return isInRange(value, fundThresholds.roce_min, fundThresholds.roce_max) ? 'pass' : 'fail';
            case 'debt_equity':
                return isInRange(value, fundThresholds.debt_equity_min, fundThresholds.debt_equity_max) ? 'pass' : 'fail';
            default:
                return 'neutral';
        }
    };

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

            {/* Enhanced Fundamental Metrics Section with Thresholds */}
            {stock.fundamentals && (
                <div className="fundamentals-section">
                    <div
                        className="fundamentals-header cursor-pointer"
                        onClick={() => setShowDetails(!showDetails)}
                    >
                        <span className="fundamentals-label">
                            <TrendingUp size={14} /> Fundamentals
                        </span>
                        <ArrowUpRight size={14} className={`arrow ${showDetails ? 'rotate' : ''}`} />
                    </div>

                    <div className={`fundamentals-grid ${showDetails ? 'expanded' : ''}`}>
                        {/* Revenue Growth */}
                        <div className={`fund-item ${getMetricStatus(stock.fundamentals.revenue_growth, 'revenue_growth')}`}>
                            <div className="fund-row">
                                <span className="fund-label">Rev Growth</span>
                                <span className="fund-value">{stock.fundamentals.revenue_growth}%</span>
                            </div>
                            {showDetails && (
                                <span className="fund-threshold">
                                    Target: {fundThresholds.revenue_growth_min}%-{fundThresholds.revenue_growth_max}%
                                </span>
                            )}
                        </div>

                        {/* ROE */}
                        <div className={`fund-item ${getMetricStatus(stock.fundamentals.roe, 'roe')}`}>
                            <div className="fund-row">
                                <span className="fund-label">ROE</span>
                                <span className="fund-value">{stock.fundamentals.roe}%</span>
                            </div>
                            {showDetails && (
                                <span className="fund-threshold">
                                    Target: {fundThresholds.roe_min}%-{fundThresholds.roe_max}%
                                </span>
                            )}
                        </div>

                        {/* ROCE */}
                        <div className={`fund-item ${getMetricStatus(stock.fundamentals.roce, 'roce')}`}>
                            <div className="fund-row">
                                <span className="fund-label">ROCE</span>
                                <span className="fund-value">{stock.fundamentals.roce}%</span>
                            </div>
                            {showDetails && (
                                <span className="fund-threshold">
                                    Target: {fundThresholds.roce_min}%-{fundThresholds.roce_max}%
                                </span>
                            )}
                        </div>

                        {/* Profit Growth */}
                        <div className={`fund-item ${getMetricStatus(stock.fundamentals.profit_growth, 'profit_growth')}`}>
                            <div className="fund-row">
                                <span className="fund-label">Profit Growth</span>
                                <span className="fund-value">{stock.fundamentals.profit_growth}%</span>
                            </div>
                            {showDetails && (
                                <span className="fund-threshold">
                                    Target: {fundThresholds.profit_growth_min}%-{fundThresholds.profit_growth_max}%
                                </span>
                            )}
                        </div>

                        {/* Debt/Equity */}
                        <div className={`fund-item ${getMetricStatus(stock.fundamentals.debt_equity, 'debt_equity')}`}>
                            <div className="fund-row">
                                <span className="fund-label">D/E Ratio</span>
                                <span className="fund-value">{stock.fundamentals.debt_equity}</span>
                            </div>
                            {showDetails && (
                                <span className="fund-threshold">
                                    Target: {fundThresholds.debt_equity_min}-{fundThresholds.debt_equity_max}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Fundamental Thesis Summary */}
            {stock.fundamental_thesis && (
                <div className="thesis-summary">
                    <p className="thesis-text">{stock.fundamental_thesis}</p>
                </div>
            )}
        </div>
    );
};

export default StockCard;
