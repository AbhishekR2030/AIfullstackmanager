import React, { useState, useEffect } from 'react';
import { getPortfolio, addTrade, deleteTrade, searchStocks } from '../services/api';
import { Plus, TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import './Portfolio.css';

const Portfolio = () => {
    const [portfolio, setPortfolio] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    // Autocomplete State
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [searchTimeout, setSearchTimeout] = useState(null);

    // New Trade Form State
    const [newTrade, setNewTrade] = useState({
        ticker: '',
        buy_date: '',
        buy_price: '',
        quantity: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        loadPortfolio();
    }, []);

    const loadPortfolio = async () => {
        setLoading(true);
        try {
            const data = await getPortfolio();
            setPortfolio(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleTickerChange = (e) => {
        const value = e.target.value;
        setNewTrade({ ...newTrade, ticker: value });

        if (searchTimeout) clearTimeout(searchTimeout);

        if (value.length > 1) {
            const timeout = setTimeout(async () => {
                const results = await searchStocks(value);
                if (results) {
                    setSuggestions(results);
                    setShowSuggestions(true);
                }
            }, 400); // 400ms debounce
            setSearchTimeout(timeout);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
        }
    };

    const selectSuggestion = (stock) => {
        setNewTrade({ ...newTrade, ticker: stock.symbol });
        setShowSuggestions(false);
    };

    const handleDelete = async (ticker) => {
        if (window.confirm(`Are you sure you want to remove ${ticker}?`)) {
            try {
                await deleteTrade(ticker);
                loadPortfolio();
            } catch (err) {
                alert("Failed to delete trade");
            }
        }
    };

    const handleAddTrade = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            // Basic Formatting
            let tickerSymbol = newTrade.ticker.trim().toUpperCase();
            if (!tickerSymbol.endsWith('.NS') && !tickerSymbol.endsWith('.BO')) {
                tickerSymbol += '.NS';
            }

            const formattedTrade = {
                ...newTrade,
                ticker: tickerSymbol,
                buy_price: parseFloat(newTrade.buy_price),
                quantity: parseInt(newTrade.quantity)
            };

            await addTrade(formattedTrade);
            setShowAddModal(false);
            setNewTrade({ ticker: '', buy_date: '', buy_price: '', quantity: '' });
            loadPortfolio();
        } catch (error) {
            alert("Failed to add trade");
        } finally {
            setIsSubmitting(false);
        }
    };

    const totalValue = portfolio.reduce((acc, curr) => acc + (curr.total_value || 0), 0);
    const totalInvested = portfolio.reduce((acc, curr) => acc + (curr.buy_price * curr.quantity), 0);
    const totalPL = totalValue - totalInvested;
    const totalPLPercent = totalInvested ? (totalPL / totalInvested) * 100 : 0;

    return (
        <div className="portfolio-page">
            <div className="portfolio-header">
                <div>
                    <h1>My Portfolio</h1>
                    <p className="text-muted">Track your active positions.</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                    <Plus size={20} /> Add Trade
                </button>
            </div>

            {/* Summary Card */}
            <div className="portfolio-summary">
                <div className="summary-item">
                    <span className="label">Current Value</span>
                    <span className="value">₹{totalValue.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="label">Invested</span>
                    <span className="value">₹{totalInvested.toLocaleString()}</span>
                </div>
                <div className="summary-item">
                    <span className="label">Total Return</span>
                    <div className={`value ${totalPL >= 0 ? 'text-success' : 'text-danger'}`} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {totalPL >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                        <span>₹{Math.abs(totalPL).toLocaleString()} ({Math.abs(totalPLPercent).toFixed(2)}%)</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p className="mt-2">Fetching live prices...</p>
                </div>
            ) : portfolio.length === 0 ? (
                <div className="empty-state">
                    <p>No trades yet. Add your first position!</p>
                </div>
            ) : (
                <div className="portfolio-table-container">
                    <table className="portfolio-table">
                        <thead>
                            <tr>
                                <th>Asset</th>
                                <th>Avg. Price</th>
                                <th>Qty</th>
                                <th>Current Price</th>
                                <th>Current Value</th>
                                <th>P&L</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {portfolio.map((trade, index) => (
                                <tr key={index}>
                                    <td className="fw-bold">{trade.ticker}</td>
                                    <td>₹{trade.buy_price}</td>
                                    <td>{trade.quantity}</td>
                                    <td>₹{trade.current_price}</td>
                                    <td>₹{trade.total_value}</td>
                                    <td className={trade.pl_percent >= 0 ? 'text-success' : 'text-danger'}>
                                        {trade.pl_percent >= 0 ? '+' : ''}{trade.pl_percent}%
                                    </td>
                                    <td>
                                        <button className="btn-icon text-danger" onClick={() => handleDelete(trade.ticker)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add Trade Modal */}
            {showAddModal && (
                <div className="modal-overlay">
                    <div className="modal-container card" style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h2>Add New Trade</h2>
                            <button className="btn-icon" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleAddTrade} className="add-trade-form">
                            <div className="form-group relative">
                                <label>Ticker Symbol (e.g. RELIANCE)</label>
                                <input
                                    type="text"
                                    placeholder="Search stock..."
                                    value={newTrade.ticker}
                                    onChange={handleTickerChange}
                                    onFocus={() => { if (newTrade.ticker) setShowSuggestions(true); }}
                                    autoComplete="off"
                                    required
                                />
                                {showSuggestions && suggestions.length > 0 && (
                                    <ul className="suggestions-list">
                                        {suggestions.map((s) => (
                                            <li key={s.symbol} onClick={() => selectSuggestion(s)}>
                                                <span className="fw-bold">{s.symbol}</span>
                                                <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: '10px' }}>{s.name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="form-group">
                                <label>Buy Date</label>
                                <input
                                    type="date"
                                    value={newTrade.buy_date}
                                    onChange={(e) => setNewTrade({ ...newTrade, buy_date: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Buy Price (₹)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    placeholder="150.00"
                                    value={newTrade.buy_price}
                                    onChange={(e) => setNewTrade({ ...newTrade, buy_price: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Quantity</label>
                                <input
                                    type="number"
                                    placeholder="10"
                                    value={newTrade.quantity}
                                    onChange={(e) => setNewTrade({ ...newTrade, quantity: e.target.value })}
                                    required
                                />
                            </div>
                            <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
                                {isSubmitting ? 'Adding...' : 'Add Trade'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Portfolio;
