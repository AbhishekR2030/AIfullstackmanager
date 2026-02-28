import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Expand, RefreshCw, Shrink, ArrowRight } from 'lucide-react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { fetchPortfolioHistory, getPortfolio } from '../services/api';
import {
    PORTFOLIO_UPDATED_EVENT,
    readPortfolioCache,
    readPortfolioHistoryCache,
    summarizePortfolio,
    writePortfolioCache,
    writePortfolioHistoryCache,
} from '../services/portfolioStore';
import { readWatchlist, WATCHLIST_UPDATED_EVENT } from '../services/watchlistStore';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const formatSignedCurrency = (value) => {
    const numericValue = Number(value || 0);
    return `${numericValue >= 0 ? '+' : '-'}₹${Math.abs(numericValue).toLocaleString('en-IN', {
        maximumFractionDigits: 0,
    })}`;
};

const formatSignedPercent = (value) => {
    const numericValue = Number(value || 0);
    return `${numericValue >= 0 ? '+' : ''}${numericValue.toFixed(2)}%`;
};

const formatCurrency = (value) => {
    const numericValue = Number(value || 0);
    return `₹${numericValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const formatAxisDate = (dateValue) => {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
        return dateValue;
    }
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(parsed);
};

const formatTooltipDate = (dateValue) => {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
        return dateValue;
    }
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(parsed);
};

const Dashboard = () => {
    const navigate = useNavigate();
    const [history, setHistory] = useState(null);
    const [summary, setSummary] = useState({ totalValue: 0, totalReturn: 0, totalReturnPercent: 0 });
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState('1y');
    const [chartMode, setChartMode] = useState('percent');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedMode, setExpandedMode] = useState(null);
    const [viewport, setViewport] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
    });
    const [watchlistItems, setWatchlistItems] = useState(() => readWatchlist());
    const isExpanded = expandedMode !== null;
    const isExpandedLandscape = expandedMode === 'landscape';

    useEffect(() => {
        document.documentElement.classList.add('dashboard-theme');
        document.body.classList.add('dashboard-theme');
        return () => {
            document.documentElement.classList.remove('dashboard-theme');
            document.body.classList.remove('dashboard-theme');
        };
    }, []);

    useEffect(() => {
        const originalBodyOverflow = document.body.style.overflow;
        const originalHtmlOverflow = document.documentElement.style.overflow;

        if (isExpanded) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = originalBodyOverflow;
            document.documentElement.style.overflow = originalHtmlOverflow;
        }

        return () => {
            document.body.style.overflow = originalBodyOverflow;
            document.documentElement.style.overflow = originalHtmlOverflow;
        };
    }, [isExpanded]);

    useEffect(() => {
        if (!isExpanded) {
            return undefined;
        }

        const readViewport = () => {
            const visualViewport = window.visualViewport;
            if (visualViewport) {
                return {
                    width: Math.round(visualViewport.width),
                    height: Math.round(visualViewport.height),
                };
            }
            return {
                width: Math.round(window.innerWidth),
                height: Math.round(window.innerHeight),
            };
        };

        const updateViewport = () => {
            setViewport(readViewport());
        };

        updateViewport();
        window.addEventListener('resize', updateViewport);
        window.addEventListener('orientationchange', updateViewport);
        window.visualViewport?.addEventListener('resize', updateViewport);

        return () => {
            window.removeEventListener('resize', updateViewport);
            window.removeEventListener('orientationchange', updateViewport);
            window.visualViewport?.removeEventListener('resize', updateViewport);
        };
    }, [isExpanded]);

    const hydrateFromCache = useCallback((period) => {
        const cachedPortfolio = readPortfolioCache();
        if (cachedPortfolio.items.length > 0) {
            const metrics = summarizePortfolio(cachedPortfolio.items);
            setSummary({
                totalValue: metrics.totalValue,
                totalReturn: metrics.totalReturn,
                totalReturnPercent: metrics.totalReturnPercent,
            });
            setLoading(false);
        }

        const cachedHistory = readPortfolioHistoryCache(period);
        if (cachedHistory && Array.isArray(cachedHistory.dates) && cachedHistory.dates.length > 0) {
            setHistory(cachedHistory);
            setLoading(false);
        }
    }, []);

    const loadData = useCallback(async ({ background = false } = {}) => {
        if (!background) {
            setLoading(true);
        } else {
            setIsRefreshing(true);
        }

        try {
            const [histData, portfolioData] = await Promise.all([
                fetchPortfolioHistory(timeRange),
                getPortfolio(),
            ]);

            setHistory(histData);
            writePortfolioHistoryCache(timeRange, histData);

            writePortfolioCache(portfolioData);

            const metrics = summarizePortfolio(portfolioData);
            setSummary({
                totalValue: metrics.totalValue,
                totalReturn: metrics.totalReturn,
                totalReturnPercent: metrics.totalReturnPercent,
            });
        } catch (error) {
            console.error("Dashboard Load Error:", error);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [timeRange]);

    useEffect(() => {
        hydrateFromCache(timeRange);
        loadData({ background: true });
    }, [hydrateFromCache, loadData, timeRange]);

    useEffect(() => {
        const handlePortfolioUpdated = (event) => {
            const updatedItems = event?.detail?.items;
            if (Array.isArray(updatedItems)) {
                const metrics = summarizePortfolio(updatedItems);
                setSummary({
                    totalValue: metrics.totalValue,
                    totalReturn: metrics.totalReturn,
                    totalReturnPercent: metrics.totalReturnPercent,
                });
            }
            loadData({ background: true });
        };

        window.addEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated);
        return () => {
            window.removeEventListener(PORTFOLIO_UPDATED_EVENT, handlePortfolioUpdated);
        };
    }, [loadData]);

    useEffect(() => {
        const syncWatchlist = () => {
            setWatchlistItems(readWatchlist());
        };

        window.addEventListener(WATCHLIST_UPDATED_EVENT, syncWatchlist);
        return () => {
            window.removeEventListener(WATCHLIST_UPDATED_EVENT, syncWatchlist);
        };
    }, []);

    const lockOrientation = async (mode) => {
        try {
            await ScreenOrientation.lock({ orientation: mode });
            return;
        } catch {
            // Fall back to browser orientation lock if native plugin is unavailable.
        }

        try {
            if (screen.orientation?.lock) {
                await screen.orientation.lock(mode);
            }
        } catch {
            // iOS WebView may reject orientation lock; expanded view still opens.
        }
    };

    const openExpanded = async () => {
        setViewport({
            width: Math.round(window.visualViewport?.width || window.innerWidth),
            height: Math.round(window.visualViewport?.height || window.innerHeight),
        });
        setExpandedMode('portrait');
        await lockOrientation('portrait');
    };

    const setExpandedOrientation = async (mode) => {
        setExpandedMode(mode);
        await lockOrientation(mode);
    };

    const closeExpanded = async () => {
        setExpandedMode(null);
        try {
            await ScreenOrientation.unlock();
        } catch {
            // Fall back to browser unlock on unsupported environments.
        }

        try {
            if (screen.orientation?.unlock) {
                screen.orientation.unlock();
            }
        } catch {
            // No-op on unsupported platforms.
        }
    };

    const chartVisuals = useMemo(() => {
        const totalReturnNegative = Number(summary.totalReturn || 0) < 0;

        if (chartMode === 'value') {
            return {
                label: 'Portfolio Value (₹)',
                getData: () => history?.portfolio_value || [],
                borderColor: totalReturnNegative ? '#c73a47' : '#4255d2',
                backgroundColor: totalReturnNegative ? 'rgba(199, 58, 71, 0.12)' : 'rgba(66, 85, 210, 0.12)',
            };
        }

        const percentSeries = (history?.portfolio_value || []).map((value, index) => {
            const invested = history?.invested_value?.[index];
            if (!invested) {
                return 0;
            }
            return ((value - invested) / invested) * 100;
        });
        return {
            label: 'Portfolio Return (%)',
            getData: () => percentSeries,
            borderColor: '#169a4d',
            backgroundColor: 'rgba(22, 154, 77, 0.12)',
        };
    }, [chartMode, history, summary.totalReturn]);

    const chartData = useMemo(() => {
        if (!history || !history.dates || history.dates.length === 0) {
            return null;
        }

        const isPercentMode = chartMode === 'percent';
        const values = chartVisuals.getData();
        const lineDataset = {
            label: chartVisuals.label,
            data: values,
            borderColor: chartVisuals.borderColor,
            backgroundColor: chartVisuals.backgroundColor,
            tension: 0.35,
            fill: isPercentMode
                ? {
                    target: 'origin',
                    above: 'rgba(22, 154, 77, 0.12)',
                    below: 'rgba(199, 58, 71, 0.16)',
                }
                : true,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.3,
            segment: isPercentMode
                ? {
                    borderColor: (context) => {
                        const y0 = Number(context.p0.parsed.y || 0);
                        const y1 = Number(context.p1.parsed.y || 0);
                        const midpoint = (y0 + y1) / 2;
                        return midpoint < 0 ? '#c73a47' : '#169a4d';
                    },
                }
                : undefined,
        };

        return {
            labels: history.dates,
            datasets: [lineDataset],
        };
    }, [chartMode, chartVisuals, history]);

    const chartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: isExpanded
                ? { top: 12, right: 14, bottom: 8, left: 14 }
                : { top: 6, right: 6, bottom: 4, left: 6 },
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    title: (context) => {
                        const rawLabel = context?.[0]?.label;
                        return formatTooltipDate(rawLabel);
                    },
                    label: (context) => {
                        const value = Number(context.parsed.y || 0);
                        if (chartMode === 'value') {
                            return `Portfolio: ₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                        }
                        return `Return: ${value.toFixed(2)}%`;
                    },
                },
            },
        },
        scales: {
            x: {
                grid: {
                    display: false,
                },
                ticks: {
                    color: '#8c94a8',
                    maxTicksLimit: isExpandedLandscape ? 8 : 5,
                    autoSkip: true,
                    maxRotation: 0,
                    minRotation: 0,
                    padding: 8,
                    callback(value) {
                        const rawLabel = this.getLabelForValue(value);
                        return formatAxisDate(rawLabel);
                    },
                },
            },
            y: {
                grid: {
                    color: '#e8ebf5',
                },
                ticks: {
                    color: '#8c94a8',
                    maxTicksLimit: isExpandedLandscape ? 8 : 7,
                    callback: (value) => (chartMode === 'value'
                        ? `₹${Number(value).toLocaleString('en-IN')}`
                        : `${value}%`),
                },
            },
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false,
        },
    }), [chartMode, isExpanded, isExpandedLandscape]);

    const renderChartCard = ({ expanded = false, orientation = 'portrait' } = {}) => (
        <section className={`dashboard-chart-card ${expanded ? 'expanded' : ''} ${expanded && orientation === 'landscape' ? 'landscape' : 'portrait'}`}>
            <div className="dashboard-chart-head">
                <div>
                    <h2>Portfolio Analysis</h2>
                    <p className={summary.totalReturn >= 0 ? 'positive' : 'negative'}>
                        {formatSignedCurrency(summary.totalReturn)} ({formatSignedPercent(summary.totalReturnPercent)})
                    </p>
                </div>

                <div className="dashboard-head-actions">
                    {expanded && (
                        <div className="dashboard-orientation-group">
                            <button
                                type="button"
                                className={`dashboard-orientation-btn ${orientation === 'portrait' ? 'active' : ''}`}
                                onClick={() => setExpandedOrientation('portrait')}
                            >
                                Portrait
                            </button>
                            <button
                                type="button"
                                className={`dashboard-orientation-btn ${orientation === 'landscape' ? 'active' : ''}`}
                                onClick={() => setExpandedOrientation('landscape')}
                            >
                                Landscape
                            </button>
                        </div>
                    )}

                    <button
                        type="button"
                        className="dashboard-icon-button"
                        onClick={() => loadData({ background: true })}
                        title="Refresh dashboard"
                        aria-label="Refresh dashboard"
                    >
                        <RefreshCw size={18} className={isRefreshing ? 'spin-animation' : ''} />
                    </button>

                    <button
                        type="button"
                        className="dashboard-icon-button"
                        onClick={expanded ? closeExpanded : openExpanded}
                        title={expanded ? 'Close expanded view' : 'Open expanded view'}
                        aria-label={expanded ? 'Close expanded view' : 'Open expanded view'}
                    >
                        {expanded ? <Shrink size={18} /> : <Expand size={18} />}
                    </button>
                </div>
            </div>

            <div className="dashboard-controls">
                <div className="dashboard-toggle-group">
                    <button
                        className={`dashboard-toggle-btn ${chartMode === 'percent' ? 'active' : ''}`}
                        onClick={() => setChartMode('percent')}
                    >
                        % Return
                    </button>
                    <button
                        className={`dashboard-toggle-btn ${chartMode === 'value' ? 'active' : ''}`}
                        onClick={() => setChartMode('value')}
                    >
                        Value
                    </button>
                </div>

                <div className="dashboard-time-group">
                    {['1mo', '3mo', '6mo', '1y', 'ytd', 'all'].map((range) => (
                        <button
                            key={range}
                            className={`dashboard-time-btn ${timeRange === range ? 'active' : ''}`}
                            onClick={() => setTimeRange(range)}
                        >
                            {range.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div className="dashboard-chart-wrapper">
                {loading ? (
                    <div className="dashboard-empty-state">Loading chart...</div>
                ) : chartData ? (
                    <Line
                        key={`${orientation}-${viewport.width}-${viewport.height}-${chartMode}-${timeRange}`}
                        data={chartData}
                        options={chartOptions}
                    />
                ) : (
                    <div className="dashboard-empty-state">No chart data yet. Add holdings or sync broker data.</div>
                )}
            </div>
        </section>
    );

    return (
        <div className="dashboard-native-page">
            {renderChartCard()}

            {!isExpanded && (
                <section className="dashboard-watchlist-card">
                    <div className="dashboard-watchlist-head">
                        <div>
                            <h3>Watchlist</h3>
                            <p>{watchlistItems.length} ideas saved from Discovery</p>
                        </div>
                        <button
                            type="button"
                            className="dashboard-watchlist-link"
                            onClick={() => navigate('/discovery')}
                        >
                            Manage
                            <ArrowRight size={14} />
                        </button>
                    </div>

                    {watchlistItems.length === 0 ? (
                        <p className="dashboard-watchlist-empty">
                            No watchlist ideas yet. Run Discovery scan and tap "Add to Watchlist".
                        </p>
                    ) : (
                        <div className="dashboard-watchlist-grid">
                            {watchlistItems.slice(0, 6).map((item) => (
                                <article className="dashboard-watchlist-item" key={item.ticker}>
                                    <div className="dashboard-watchlist-item-top">
                                        <strong>{item.ticker}</strong>
                                        <span className={`dashboard-watchlist-return ${Number(item.expectedReturn || 0) >= 0 ? 'positive' : 'negative'}`}>
                                            {formatSignedPercent(Number(item.expectedReturn || 0))}
                                        </span>
                                    </div>
                                    <p>{item.source || 'Discovery'}</p>
                                    <div className="dashboard-watchlist-prices">
                                        <span>Current {formatCurrency(item.currentPrice)}</span>
                                        <span>Target {formatCurrency(item.targetPrice)}</span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {isExpanded && (
                <div className="dashboard-landscape-overlay">
                    <div
                        className={`dashboard-landscape-stage ${isExpandedLandscape ? 'landscape' : 'portrait'}`}
                        style={{ width: `${viewport.width}px`, height: `${viewport.height}px` }}
                    >
                        {renderChartCard({ expanded: true, orientation: expandedMode })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
