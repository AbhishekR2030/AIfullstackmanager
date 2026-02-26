import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPortfolio, addTrade, deleteTrade, searchStocks, syncHDFCPortfolio, getHDFCLoginUrl } from '../services/api';
import {
    ArrowRight,
    Eye,
    EyeOff,
    Plus,
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import './Portfolio.css';

const MOBILE_HDFC_REDIRECT = 'com.alphaseeker.india://auth/callback';
const HOLDING_SEGMENTS = ['Holdings', 'MTF', 'Mutual Fund', 'Others'];

const formatCurrency = (value, decimals = 2) => {
    const numericValue = Number(value ?? 0);
    return `₹${numericValue.toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}`;
};

const formatSignedCurrency = (value, decimals = 2) => {
    const numericValue = Number(value ?? 0);
    const prefix = numericValue >= 0 ? '+' : '-';
    return `${prefix}${formatCurrency(Math.abs(numericValue), decimals)}`;
};

const formatSignedPercent = (value) => {
    const numericValue = Number(value ?? 0);
    return `${numericValue >= 0 ? '+' : ''}${numericValue.toFixed(2)}%`;
};

const getSyncErrorMessage = (error) => {
    if (!error?.response) {
        return "Unable to reach backend. Check network connectivity.";
    }

    const { status, data } = error.response;
    if (typeof data === 'string' && data.trim()) {
        return data;
    }
    if (typeof data?.detail === 'string' && data.detail.trim()) {
        return data.detail;
    }
    if (typeof data?.error === 'string' && data.error.trim()) {
        return data.error;
    }
    if (typeof data?.message === 'string' && data.message.trim()) {
        return data.message;
    }

    return `HDFC sync failed (${status})`;
};

const Portfolio = () => {
    const navigate = useNavigate();
    const [portfolio, setPortfolio] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [showValues, setShowValues] = useState(true);
    const [activeSegment, setActiveSegment] = useState('Holdings');
    const [showTodaysPl, setShowTodaysPl] = useState(false);

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
            } catch {
                alert("Failed to delete trade");
            }
        }
    };

    const handleSyncHDFC = async () => {
        setIsSyncing(true);
        try {
            // First try simple sync (assumes token exists on backend)
            await syncHDFCPortfolio();
            await loadPortfolio();
            alert("Portfolio synced successfully with HDFC!");
        } catch (error) {
            const syncErrorMessage = getSyncErrorMessage(error);
            console.error("Sync failed:", syncErrorMessage, error);

            const needsAuthorization = /authorization|expired|token|unauthoriz|login/i.test(syncErrorMessage);
            if (!needsAuthorization) {
                alert(`HDFC sync failed: ${syncErrorMessage}`);
                return;
            }

            const confirmLogin = window.confirm(
                `HDFC Sync requires re-authorization.\n\nReason: ${syncErrorMessage}\n\nDo you want to login to HDFC InvestRight now?`
            );
            if (!confirmLogin) {
                return;
            }

            const redirectUri = Capacitor.isNativePlatform() ? MOBILE_HDFC_REDIRECT : null;
            const loginUrl = await getHDFCLoginUrl(redirectUri);
            if (loginUrl) {
                try {
                    // Use Capacitor Browser plugin to open in-app browser
                    // This keeps the main app alive so session is preserved
                    const { Browser } = await import('@capacitor/browser');

                    await Browser.open({ url: loginUrl });
                    if (Capacitor.isNativePlatform()) {
                        alert("Complete HDFC login and return to app. Sync continues automatically after callback.");
                    }
                } catch (browserErr) {
                    // Fallback for web: open in new tab instead of navigating away
                    console.log("Browser plugin not available, opening in new tab", browserErr);
                    window.open(loginUrl, '_blank');
                }
            } else {
                alert("Could not get login URL from backend.");
            }
        } finally {
            setIsSyncing(false);
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
        } catch {
            alert("Failed to add trade");
        } finally {
            setIsSubmitting(false);
        }
    };

    const sortedHoldings = useMemo(
        () => [...portfolio].sort((a, b) => (b.total_value || 0) - (a.total_value || 0)),
        [portfolio]
    );

    const totalValue = useMemo(
        () => sortedHoldings.reduce((acc, curr) => acc + (Number(curr.total_value) || 0), 0),
        [sortedHoldings]
    );
    const totalInvested = useMemo(
        () => sortedHoldings.reduce((acc, curr) => acc + ((Number(curr.buy_price) || 0) * (Number(curr.quantity) || 0)), 0),
        [sortedHoldings]
    );
    const totalPL = totalValue - totalInvested;
    const totalPLPercent = totalInvested ? (totalPL / totalInvested) * 100 : 0;

    const rankedByPerformance = useMemo(
        () => [...sortedHoldings].sort((a, b) => (Number(b.pl_percent) || 0) - (Number(a.pl_percent) || 0)),
        [sortedHoldings]
    );
    const topGainer = rankedByPerformance[0] || null;
    const topLoser = rankedByPerformance.length > 1
        ? rankedByPerformance[rankedByPerformance.length - 1]
        : null;

    const displayedPlAmount = totalPL;
    const displayedPlPercent = totalPLPercent;
    const isHoldingView = activeSegment === 'Holdings';
    const totalLabel = showTodaysPl ? "Today's P/L" : 'Unrealised P/L';

    return (
        <div className="portfolio-native-page">
            <div className="portfolio-native-header">
                <div className="portfolio-title-wrap">
                    <h1>Portfolio</h1>
                    <span className="title-divider" />
                    <span className="portfolio-subtitle">Demat</span>
                </div>
                <div className="portfolio-header-right">
                    <button
                        className="portfolio-icon-button"
                        type="button"
                        aria-label="Search holdings"
                        title="Search coming soon"
                    >
                        <Search size={20} />
                    </button>
                    <button className="portfolio-avatar-button" type="button" aria-label="Account">
                        AC
                    </button>
                </div>
            </div>

            <div className="portfolio-segment-tabs">
                {HOLDING_SEGMENTS.map((segment) => (
                    <button
                        key={segment}
                        type="button"
                        className={`segment-tab ${activeSegment === segment ? 'active' : ''}`}
                        onClick={() => setActiveSegment(segment)}
                    >
                        {segment}
                    </button>
                ))}
            </div>

            {isHoldingView ? (
                <>
                    <div className="portfolio-overview-card">
                        <div className="pl-toggle-row">
                            <span className={!showTodaysPl ? 'active' : ''}>Total</span>
                            <button
                                type="button"
                                className={`pl-switch ${showTodaysPl ? 'today' : ''}`}
                                onClick={() => setShowTodaysPl((prev) => !prev)}
                                aria-label="Toggle total and today's P/L"
                            >
                                <span className="pl-switch-thumb" />
                            </button>
                            <span className={showTodaysPl ? 'active' : ''}>Today's</span>
                        </div>

                        <div className="pl-block">
                            <div className="pl-label-row">
                                <span>{totalLabel}</span>
                                <button
                                    type="button"
                                    className="value-visibility-btn"
                                    onClick={() => setShowValues((prev) => !prev)}
                                    aria-label={showValues ? 'Hide values' : 'Show values'}
                                >
                                    {showValues ? <Eye size={18} /> : <EyeOff size={18} />}
                                </button>
                            </div>
                            <div className={`pl-value ${displayedPlAmount >= 0 ? 'up' : 'down'}`}>
                                {showValues ? formatSignedCurrency(displayedPlAmount, 0) : '••••••'}
                            </div>
                            <div className={`pl-percent ${displayedPlAmount >= 0 ? 'up' : 'down'}`}>
                                {showValues ? formatSignedPercent(displayedPlPercent) : '•••'}
                            </div>
                        </div>

                        <div className="overview-divider" />
                        <div className="overview-grid">
                            <div>
                                <span>Current</span>
                                <strong>{showValues ? formatCurrency(totalValue, 0) : '••••••'}</strong>
                            </div>
                            <div>
                                <span>Invested</span>
                                <strong>{showValues ? formatCurrency(totalInvested, 0) : '••••••'}</strong>
                            </div>
                        </div>
                    </div>

                    <div className="movers-card">
                        <h3>Overall Portfolio Movers</h3>
                        <div className="movers-grid">
                            <div className="mover-column">
                                <span className="mover-tag gain">TOP GAINER</span>
                                <strong>{topGainer?.ticker || '--'}</strong>
                                <span className="mover-value up">
                                    {topGainer ? formatSignedPercent(topGainer.pl_percent) : '--'}
                                </span>
                            </div>
                            <div className="mover-divider" />
                            <div className="mover-column">
                                <span className="mover-tag loss">TOP LOSER</span>
                                <strong>{topLoser?.ticker || '--'}</strong>
                                <span className="mover-value down">
                                    {topLoser ? formatSignedPercent(topLoser.pl_percent) : '--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="analysis-cta"
                        onClick={() => navigate('/')}
                    >
                        <div className="analysis-copy">
                            <span>PORTFOLIO HEALTH</span>
                            <strong>View Portfolio Analysis</strong>
                        </div>
                        <span className="analysis-icon">
                            <ArrowRight size={22} />
                        </span>
                    </button>

                    <section className="holdings-section">
                        <div className="holdings-toolbar">
                            <h2>Stocks ({sortedHoldings.length})</h2>
                            <div className="holdings-toolbar-actions">
                                <button
                                    className="portfolio-icon-button"
                                    type="button"
                                    title="Sync from HDFC InvestRight"
                                    onClick={handleSyncHDFC}
                                    disabled={isSyncing}
                                >
                                    <RefreshCw size={18} className={isSyncing ? "spin-animation" : ""} />
                                </button>
                                <button
                                    className="portfolio-icon-button"
                                    type="button"
                                    title="Add manual trade"
                                    onClick={() => setShowAddModal(true)}
                                >
                                    <Plus size={18} />
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="portfolio-loading">Fetching live prices...</div>
                        ) : sortedHoldings.length === 0 ? (
                            <div className="portfolio-empty">
                                <p>No holdings yet. Add your first trade or sync from HDFC.</p>
                            </div>
                        ) : (
                            <div className="holding-list">
                                {sortedHoldings.map((trade, index) => {
                                    const investedValue = (Number(trade.buy_price) || 0) * (Number(trade.quantity) || 0);
                                    const currentValue = Number(trade.total_value) || 0;
                                    const plAmount = Number(trade.pl_amount) || 0;
                                    const ltpDelta = (Number(trade.current_price) || 0) - (Number(trade.buy_price) || 0);
                                    const ltpDeltaPct = trade.buy_price
                                        ? (ltpDelta / Number(trade.buy_price)) * 100
                                        : 0;

                                    return (
                                        <article className="holding-row" key={`${trade.ticker}-${index}`}>
                                            <div className="holding-meta">
                                                <span>Qty <strong>{trade.quantity}</strong></span>
                                                <span className="meta-separator" />
                                                <span>Avg <strong>{formatCurrency(trade.buy_price, 2)}</strong></span>
                                            </div>
                                            <div className="holding-main">
                                                <div className="holding-title-wrap">
                                                    <h3>{trade.company_name || trade.ticker}</h3>
                                                    {trade.company_name ? <p>{trade.ticker}</p> : null}
                                                </div>
                                                <div className="holding-ltp">
                                                    <span>LTP {formatCurrency(trade.current_price, 2)}</span>
                                                    <small className={ltpDelta >= 0 ? 'up' : 'down'}>
                                                        {formatSignedCurrency(ltpDelta, 2)} ({formatSignedPercent(ltpDeltaPct)})
                                                    </small>
                                                </div>
                                            </div>
                                            <div className="holding-foot">
                                                <div>
                                                    <span>Current</span>
                                                    <strong>{formatCurrency(currentValue, 2)}</strong>
                                                </div>
                                                <div>
                                                    <span>P/L</span>
                                                    <strong className={plAmount >= 0 ? 'up' : 'down'}>
                                                        {formatSignedCurrency(plAmount, 2)} ({formatSignedPercent(trade.pl_percent)})
                                                    </strong>
                                                </div>
                                                <div>
                                                    <span>Invested</span>
                                                    <strong>{formatCurrency(investedValue, 2)}</strong>
                                                </div>
                                            </div>
                                            <button
                                                className="holding-delete"
                                                type="button"
                                                onClick={() => handleDelete(trade.ticker)}
                                                title={`Delete ${trade.ticker}`}
                                                aria-label={`Delete ${trade.ticker}`}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </>
            ) : (
                <div className="coming-soon-card">
                    <h3>{activeSegment}</h3>
                    <p>This bucket is not connected yet. Holdings data is available under the Holdings tab.</p>
                </div>
            )}

            {/* Add Trade Modal */}
            {showAddModal && (
                <div className="modal-overlay">
                    <div className="modal-container">
                        <div className="modal-header">
                            <h2>Add New Trade</h2>
                            <button
                                className="modal-close"
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                aria-label="Close modal"
                            >
                                ×
                            </button>
                        </div>
                        <form onSubmit={handleAddTrade} className="add-trade-form">
                            <div className="form-group relative">
                                <label>Ticker Symbol</label>
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
                                                <span className="suggestion-name">{s.name}</span>
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
                            <button type="submit" className="save-trade-btn" disabled={isSubmitting}>
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
