import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getPortfolio,
    addTrade,
    deleteTrade,
    searchStocks,
    syncHDFCPortfolio,
    getHDFCLoginUrl,
    syncZerodhaPortfolio,
    getZerodhaLoginUrl,
} from '../services/api';
import {
    ArrowRight,
    Building2,
    CircleAlert,
    CircleCheckBig,
    CircleDashed,
    X,
    Eye,
    EyeOff,
    Plus,
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
    emitPortfolioUpdated,
    readPortfolioCache,
    writePortfolioCache,
} from '../services/portfolioStore';
import './Portfolio.css';

const MOBILE_HDFC_REDIRECT = 'com.alphaseeker.india://auth/callback';
const MOBILE_ZERODHA_REDIRECT = 'com.alphaseeker.india://zerodha/callback';
const HOLDING_SEGMENTS = ['Holdings', 'MTF', 'Mutual Fund', 'Others'];
const CONNECTORS = [
    {
        id: 'hdfc',
        name: 'HDFC InvestRight',
        subtitle: 'Tap to connect and sync',
        status: 'active',
    },
    {
        id: 'paytm-money',
        name: 'Paytm Money',
        subtitle: 'Coming soon',
        status: 'coming-soon',
    },
    {
        id: 'zerodha-kite',
        name: 'Zerodha Kite',
        subtitle: 'Tap to connect and sync',
        status: 'active',
    },
];

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

const getSyncErrorMessage = (error, brokerName = 'Broker') => {
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
    if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
        return data.error.message;
    }
    if (typeof data?.error === 'string' && data.error.trim()) {
        return data.error;
    }

    return `${brokerName} sync failed (${status})`;
};

const Portfolio = () => {
    const navigate = useNavigate();
    const [portfolio, setPortfolio] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncNotice, setSyncNotice] = useState(null);
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
        const cached = readPortfolioCache();
        if (cached.items.length > 0) {
            setPortfolio(cached.items);
            setLoading(false);
            loadPortfolio({ background: true });
            return;
        }
        loadPortfolio();
    }, []);

    useEffect(() => {
        document.documentElement.classList.add('portfolio-theme');
        document.body.classList.add('portfolio-theme');
        return () => {
            document.documentElement.classList.remove('portfolio-theme');
            document.body.classList.remove('portfolio-theme');
        };
    }, []);

    useEffect(() => {
        if (!syncNotice) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setSyncNotice(null);
        }, 5000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [syncNotice]);

    const showNotice = (tone, message) => {
        setSyncNotice({
            tone,
            message,
            id: Date.now(),
        });
    };

    const loadPortfolio = async ({ background = false } = {}) => {
        if (!background) {
            setLoading(true);
        }
        try {
            const data = await getPortfolio();
            setPortfolio(data);
            writePortfolioCache(data);
            emitPortfolioUpdated(data);
        } catch (error) {
            console.error(error);
        } finally {
            if (!background) {
                setLoading(false);
            }
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
            const previousPortfolio = [...portfolio];
            const optimisticPortfolio = previousPortfolio.filter((item) => item.ticker !== ticker);
            setPortfolio(optimisticPortfolio);
            writePortfolioCache(optimisticPortfolio);
            emitPortfolioUpdated(optimisticPortfolio);
            try {
                await deleteTrade(ticker);
                loadPortfolio({ background: true });
            } catch {
                setPortfolio(previousPortfolio);
                writePortfolioCache(previousPortfolio);
                emitPortfolioUpdated(previousPortfolio);
                showNotice('error', "Failed to delete trade.");
            }
        }
    };

    const startHdfcAuthorization = async () => {
        const redirectUri = Capacitor.isNativePlatform() ? MOBILE_HDFC_REDIRECT : null;
        const loginUrl = await getHDFCLoginUrl(redirectUri);
        if (!loginUrl) {
            showNotice('error', "Could not get HDFC login URL from backend.");
            return;
        }

        try {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: loginUrl });
            showNotice('warning', "Complete HDFC login and return to app. Sync will continue automatically.");
        } catch (browserErr) {
            console.log("Browser plugin not available, opening in new tab", browserErr);
            window.open(loginUrl, '_blank');
            showNotice('warning', "Complete HDFC login in the new tab and then come back.");
        }
    };

    const startZerodhaAuthorization = async () => {
        const appRedirect = Capacitor.isNativePlatform() ? MOBILE_ZERODHA_REDIRECT : null;
        const loginUrl = await getZerodhaLoginUrl(appRedirect);
        if (!loginUrl) {
            showNotice('error', "Could not get Zerodha login URL from backend.");
            return;
        }

        try {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: loginUrl });
            showNotice('warning', "Complete Zerodha login and return to app. Sync will continue automatically.");
        } catch (browserErr) {
            console.log("Browser plugin not available, opening in new tab", browserErr);
            window.open(loginUrl, '_blank');
            showNotice('warning', "Complete Zerodha login in the new tab and then come back.");
        }
    };

    const handleSyncHDFC = async () => {
        setIsSyncing(true);
        try {
            await syncHDFCPortfolio();
            await loadPortfolio({ background: true });
            showNotice('success', "Portfolio synced successfully from HDFC.");
        } catch (error) {
            const syncErrorMessage = getSyncErrorMessage(error);
            const statusCode = error?.response?.status;
            console.error("Sync failed:", syncErrorMessage, error);

            const needsAuthorization = statusCode === 401
                || statusCode === 403
                || /authorization|expired|token|unauthoriz|login|\b401\b|\b403\b/i.test(syncErrorMessage);

            if (!needsAuthorization) {
                showNotice('error', `HDFC sync failed: ${syncErrorMessage}`);
                return;
            }

            showNotice('warning', "HDFC session expired. Re-authorizing now.");
            await startHdfcAuthorization();
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSyncZerodha = async () => {
        setIsSyncing(true);
        try {
            await syncZerodhaPortfolio();
            await loadPortfolio({ background: true });
            showNotice('success', "Portfolio synced successfully from Zerodha.");
        } catch (error) {
            const syncErrorMessage = getSyncErrorMessage(error, 'Zerodha');
            const statusCode = error?.response?.status;
            const errorCode = error?.response?.data?.error?.code;
            console.error("Zerodha sync failed:", syncErrorMessage, error);

            const needsAuthorization = statusCode === 401
                || statusCode === 403
                || errorCode === 'BROKER_TOKEN_EXPIRED'
                || /authorization|expired|token|unauthoriz|login|connect|\b401\b|\b403\b/i.test(syncErrorMessage);

            if (!needsAuthorization) {
                showNotice('error', `Zerodha sync failed: ${syncErrorMessage}`);
                return;
            }

            showNotice('warning', "Zerodha session expired or missing. Re-authorizing now.");
            await startZerodhaAuthorization();
        } finally {
            setIsSyncing(false);
        }
    };

    const handleConnectorSync = async (connectorId) => {
        if (connectorId === 'hdfc') {
            setShowSyncModal(false);
            await handleSyncHDFC();
            return;
        }
        if (connectorId === 'zerodha-kite') {
            setShowSyncModal(false);
            await handleSyncZerodha();
            return;
        }

        setShowSyncModal(false);
        const connector = CONNECTORS.find((item) => item.id === connectorId);
        showNotice('info', `${connector?.name || 'Connector'} integration will be available soon.`);
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
            loadPortfolio({ background: true });
        } catch {
            showNotice('error', "Failed to add trade.");
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
                    {syncNotice ? (
                        <div className={`sync-notice ${syncNotice.tone}`} key={syncNotice.id}>
                            <div className="sync-notice-icon">
                                {syncNotice.tone === 'success' ? <CircleCheckBig size={16} /> : null}
                                {syncNotice.tone === 'error' ? <CircleAlert size={16} /> : null}
                                {syncNotice.tone === 'warning' ? <CircleAlert size={16} /> : null}
                                {syncNotice.tone === 'info' ? <CircleDashed size={16} /> : null}
                            </div>
                            <p>{syncNotice.message}</p>
                            <button
                                type="button"
                                className="sync-notice-close"
                                onClick={() => setSyncNotice(null)}
                                aria-label="Dismiss message"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : null}

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
                                <strong>{showValues ? (topGainer?.ticker || '--') : '••••••'}</strong>
                                <span className="mover-value up">
                                    {showValues ? (topGainer ? formatSignedPercent(topGainer.pl_percent) : '--') : '•••'}
                                </span>
                            </div>
                            <div className="mover-divider" />
                            <div className="mover-column">
                                <span className="mover-tag loss">TOP LOSER</span>
                                <strong>{showValues ? (topLoser?.ticker || '--') : '••••••'}</strong>
                                <span className="mover-value down">
                                    {showValues ? (topLoser ? formatSignedPercent(topLoser.pl_percent) : '--') : '•••'}
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
                                    title="Sync portfolio"
                                    onClick={() => setShowSyncModal(true)}
                                    disabled={isSyncing}
                                >
                                    <RefreshCw size={18} className={isSyncing ? "spin-animation" : ""} />
                                </button>
                                <button
                                    className={`portfolio-icon-button ${!showValues ? 'is-active' : ''}`}
                                    type="button"
                                    title={showValues ? "Hide portfolio details" : "Show portfolio details"}
                                    onClick={() => setShowValues((prev) => !prev)}
                                    aria-label={showValues ? "Hide portfolio details" : "Show portfolio details"}
                                    aria-pressed={!showValues}
                                >
                                    {showValues ? <Eye size={18} /> : <EyeOff size={18} />}
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
                                <p>No holdings yet. Add your first trade or sync from HDFC or Zerodha.</p>
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
                                                <span>Qty <strong>{showValues ? trade.quantity : '•••'}</strong></span>
                                                <span className="meta-separator" />
                                                <span>Avg <strong>{showValues ? formatCurrency(trade.buy_price, 2) : '••••••'}</strong></span>
                                            </div>
                                            <div className="holding-main">
                                                <div className="holding-title-wrap">
                                                    <h3>{showValues ? (trade.company_name || trade.ticker) : 'Hidden Stock'}</h3>
                                                    {showValues && trade.company_name ? <p>{trade.ticker}</p> : null}
                                                </div>
                                                <div className="holding-ltp">
                                                    <span>LTP {showValues ? formatCurrency(trade.current_price, 2) : '••••••'}</span>
                                                    <small className={ltpDelta >= 0 ? 'up' : 'down'}>
                                                        {showValues ? `${formatSignedCurrency(ltpDelta, 2)} (${formatSignedPercent(ltpDeltaPct)})` : '••••••'}
                                                    </small>
                                                </div>
                                            </div>
                                            <div className="holding-foot">
                                                <div>
                                                    <span>Current</span>
                                                    <strong>{showValues ? formatCurrency(currentValue, 2) : '••••••'}</strong>
                                                </div>
                                                <div>
                                                    <span>P/L</span>
                                                    <strong className={plAmount >= 0 ? 'up' : 'down'}>
                                                        {showValues ? `${formatSignedCurrency(plAmount, 2)} (${formatSignedPercent(trade.pl_percent)})` : '••••••'}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <span>Invested</span>
                                                    <strong>{showValues ? formatCurrency(investedValue, 2) : '••••••'}</strong>
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

            {showSyncModal && (
                <div className="modal-overlay" onClick={() => setShowSyncModal(false)}>
                    <div className="sync-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="sync-modal-head">
                            <h3>Sync Portfolio</h3>
                            <p>Select a broker connector.</p>
                        </div>
                        <div className="connector-list">
                            {CONNECTORS.map((connector) => {
                                const isActive = connector.status === 'active';
                                return (
                                    <button
                                        key={connector.id}
                                        type="button"
                                        className={`connector-row ${isActive ? 'active' : 'coming-soon'}`}
                                        onClick={() => handleConnectorSync(connector.id)}
                                        disabled={isSyncing}
                                    >
                                        <div className="connector-main">
                                            <Building2 size={17} />
                                            <div>
                                                <strong>{connector.name}</strong>
                                                <span>{connector.subtitle}</span>
                                            </div>
                                        </div>
                                        <span className={`connector-state ${isActive ? 'active' : 'soon'}`}>
                                            {isActive ? 'Available' : 'Coming soon'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
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
