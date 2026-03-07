import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchDiscoveryStrategies,
    fetchDiscoveryScan,
    triggerAsyncDiscoveryScan,
    getAsyncDiscoveryStatus,
    getAsyncDiscoveryResults,
} from '../services/api';
import ThresholdsModal, { DEFAULT_THRESHOLDS } from '../components/ThresholdsModal';
import {
    upsertWatchlistItem,
    removeWatchlistItem,
    readWatchlist,
    WATCHLIST_UPDATED_EVENT,
} from '../services/watchlistStore';
import {
    ArrowRightLeft,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    Info,
    Plus,
    RefreshCw,
    Settings,
    Sparkles,
    Target,
    TrendingUp,
} from 'lucide-react';
import './Discovery.css';

const THRESHOLDS_STORAGE_KEY = 'alphaseeker_discovery_thresholds';
const DISCOVERY_STATE_STORAGE_KEY = 'alphaseeker_discovery_state';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FALLBACK_STRATEGY_PRESETS = [
    {
        id: 'core',
        label: 'Alphaseeker Core',
        description: 'Balanced momentum + quality composite baseline.',
        details: [
            'Balanced score blending technical momentum and fundamental quality.',
            'Designed as the default core scanner with broad market compatibility.',
            'No manual threshold tuning required for baseline discovery scans.',
        ],
        thresholds: null,
    },
    {
        id: 'custom',
        label: 'Custom Thresholds',
        description: 'User-defined thresholds and scan logic.',
        details: [
            'Define your RSI, volatility, volume-shock, and fundamentals limits.',
            'Scanner applies your thresholds to identify liquid momentum candidates.',
            'Best for experimenting with your own entry/exit discipline.',
        ],
        thresholds: null,
    },
    {
        id: 'citadel_momentum',
        label: 'Citadel Momentum',
        description: 'High-liquidity momentum and quality tilt.',
        details: [
            'Focuses on strong trend continuation with strict liquidity filters.',
            'Balances momentum and quality to avoid weak balance-sheet breakouts.',
            'Designed for fast rotation into high-conviction, high-volume setups.',
        ],
        thresholds: {
            technical: { rsi_min: 53, rsi_max: 68, volatility_min: 3, volatility_max: 9, volume_shock_min: 1.6, volume_shock_max: 6.0 },
            fundamental: { revenue_growth_min: 8, revenue_growth_max: 120, profit_growth_min: 8, profit_growth_max: 120, roe_min: 14, roe_max: 100, roce_min: 14, roce_max: 100, debt_equity_min: 0, debt_equity_max: 120 },
        },
    },
    {
        id: 'jane_street_stat',
        label: 'Jane Street Statistical',
        description: 'Pairs-trading and mean-reversion inspired blend.',
        details: [
            'Combines mean-reversion checks with tactical flow and momentum signals.',
            'Targets spread dislocations with sector-relative technical context.',
            'Designed for short-horizon statistical opportunity capture.',
        ],
        thresholds: {
            technical: { rsi_min: 38, rsi_max: 62, volatility_min: 2, volatility_max: 11, volume_shock_min: 1.2, volume_shock_max: 8.0 },
            fundamental: { revenue_growth_min: 0, revenue_growth_max: 150, profit_growth_min: 0, profit_growth_max: 150, roe_min: 8, roe_max: 100, roce_min: 8, roce_max: 100, debt_equity_min: 0, debt_equity_max: 200 },
        },
    },
    {
        id: 'millennium_quality',
        label: 'Millennium Quality',
        description: 'Quality-factor focused profitability and balance-sheet screen.',
        details: [
            'Emphasizes ROE/ROCE strength, profitability quality, and earnings stability.',
            'Penalizes weak balance sheets and high leverage outliers.',
            'Aligned with quality-factor style allocation logic for robust names.',
        ],
        thresholds: {
            technical: { rsi_min: 48, rsi_max: 66, volatility_min: 2.5, volatility_max: 8, volume_shock_min: 1.4, volume_shock_max: 5.0 },
            fundamental: { revenue_growth_min: 12, revenue_growth_max: 150, profit_growth_min: 12, profit_growth_max: 150, roe_min: 16, roe_max: 100, roce_min: 16, roce_max: 100, debt_equity_min: 0, debt_equity_max: 80 },
        },
    },
    {
        id: 'de_shaw_multifactor',
        label: 'DE Shaw Multi-Factor',
        description: 'Quality, momentum, and valuation balanced screen.',
        details: [
            'Blends trend strength with profitability and valuation discipline.',
            'Filters out low-quality spikes that fail balance-sheet checks.',
            'Designed for robust multi-factor swing allocations.',
        ],
        thresholds: {
            technical: { rsi_min: 48, rsi_max: 66, volatility_min: 2.5, volatility_max: 8, volume_shock_min: 1.4, volume_shock_max: 5.0 },
            fundamental: { revenue_growth_min: 12, revenue_growth_max: 150, profit_growth_min: 12, profit_growth_max: 150, roe_min: 16, roe_max: 100, roce_min: 16, roce_max: 100, debt_equity_min: 0, debt_equity_max: 80 },
        },
    },
];

const LEGACY_STRATEGY_IDS = {
    alphaseeker_core: 'core',
    janestreet_quant: 'jane_street_stat',
    jane_street: 'jane_street_stat',
    deshaw_quality: 'de_shaw_multifactor',
    de_shaw_quality: 'de_shaw_multifactor',
    custom_trade: 'custom',
};

const normalizeStrategyId = (strategyId) => {
    const normalized = (strategyId || '').trim();
    if (!normalized) {
        return 'custom';
    }
    return LEGACY_STRATEGY_IDS[normalized] || normalized;
};

const safeParse = (raw, fallback) => {
    if (!raw) {
        return fallback;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

const resolveDiscoveryErrorMessage = (error) => {
    if (!error) {
        return 'Failed to scan market. Please try again.';
    }

    const responseData = error?.response?.data;
    if (typeof responseData === 'string' && responseData.trim()) {
        return responseData.trim();
    }
    if (typeof responseData?.detail === 'string' && responseData.detail.trim()) {
        return responseData.detail.trim();
    }
    if (typeof responseData?.message === 'string' && responseData.message.trim()) {
        return responseData.message.trim();
    }
    if (typeof responseData?.error?.message === 'string' && responseData.error.message.trim()) {
        return responseData.error.message.trim();
    }
    if (error?.message === 'Network Error') {
        return 'Unable to reach the screening service. Please retry in a few seconds.';
    }
    if (typeof error?.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }
    return 'Failed to scan market. Please try again.';
};

const normalizeTicker = (ticker) => (ticker || '').trim().toUpperCase();

const currency = (value) => {
    const numeric = Number(value || 0);
    return `₹${numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const percentSigned = (value) => {
    const numeric = Number(value || 0);
    return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
};

const isDefaultThresholds = (thresholds) => JSON.stringify(thresholds) === JSON.stringify(DEFAULT_THRESHOLDS);

const getEffectiveThresholds = (strategyId, customThresholds) => {
    if (strategyId === 'custom') {
        return customThresholds;
    }
    return null;
};

const mapBackendStrategies = (backendStrategies) => {
    if (!Array.isArray(backendStrategies) || backendStrategies.length === 0) {
        return FALLBACK_STRATEGY_PRESETS;
    }
    return backendStrategies.map((strategy) => {
        const id = normalizeStrategyId(strategy?.strategy_id || strategy?.id || 'core');
        return {
            id,
            label: strategy?.strategy_label || strategy?.label || id,
            description: strategy?.strategy_summary || strategy?.description || 'Strategy scan',
            details: Array.isArray(strategy?.strategy_logic) && strategy.strategy_logic.length
                ? strategy.strategy_logic
                : ['Strategy logic details unavailable.'],
            thresholds: null,
        };
    });
};

const rsiZoneFromScore = (score) => {
    const numeric = Number(score || 0);
    if (numeric >= 68) {
        return 'Momentum indicates RSI zone likely near 70 (overbought risk).';
    }
    if (numeric <= 42) {
        return 'Momentum indicates RSI zone likely below 40 (weak trend risk).';
    }
    return 'Momentum zone is neutral; monitor RSI for trend break signals.';
};

const buildReplacementRanking = (scanData, ideas) => {
    const swaps = Array.isArray(scanData?.swap_opportunities) ? scanData.swap_opportunities : [];
    const portfolio = Array.isArray(scanData?.portfolio_analysis) ? scanData.portfolio_analysis : [];
    const ideaMap = new Map(ideas.map((idea) => [idea.ticker, idea]));

    const buildSignals = (asset, baseReason) => {
        const signals = [];
        const plPercent = Number(asset?.pl_percent || 0);
        if (plPercent >= 20) {
            signals.push(`Stock has already yielded ${plPercent.toFixed(1)}% upside.`);
        }
        signals.push(rsiZoneFromScore(asset?.score));
        if ((asset?.trend || '').toLowerCase().includes('bearish')) {
            signals.push('Price trend has turned bearish below key moving averages.');
        }
        if (baseReason) {
            signals.push(baseReason);
        }
        signals.push('Recent price reaction can indicate negative announcement risk. Verify latest company updates before holding.');
        return signals;
    };

    if (swaps.length > 0) {
        return swaps.slice(0, 6).map((swap, index) => {
            const fromTicker = normalizeTicker(swap.sell);
            const toTicker = normalizeTicker(swap.buy) || ideas[0]?.ticker || 'N/A';
            const sellAsset = portfolio.find((asset) => normalizeTicker(asset.ticker) === fromTicker) || {};
            const buyIdea = ideaMap.get(toTicker) || ideas[0] || null;
            return {
                rank: Number(swap.priority || index + 1),
                fromTicker,
                toTicker,
                switchReason: swap.reason || 'Engine suggests rotating into stronger momentum.',
                signals: buildSignals(sellAsset, swap.reason),
                targetPrice: buyIdea?.targetPrice || 0,
                expectedReturn: buyIdea?.expectedReturn || 0,
            };
        });
    }

    const rankedPortfolio = portfolio
        .map((asset) => {
            const plPercent = Number(asset.pl_percent || 0);
            const recommendation = (asset.recommendation || '').toUpperCase();
            let rankScore = 0;
            if (recommendation.includes('SELL')) {
                rankScore += 4;
            }
            if (plPercent >= 20) {
                rankScore += 3;
            }
            if ((asset.trend || '').toLowerCase().includes('bearish')) {
                rankScore += 2;
            }
            rankScore += Number(asset.score || 0) >= 68 || Number(asset.score || 0) <= 42 ? 1 : 0;

            return {
                ...asset,
                rankScore,
            };
        })
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 6);

    return rankedPortfolio.map((asset, index) => {
        const buyIdea = ideas[index % Math.max(ideas.length, 1)] || null;
        return {
            rank: index + 1,
            fromTicker: normalizeTicker(asset.ticker),
            toTicker: buyIdea?.ticker || 'TBD',
            switchReason: asset.reason || 'Relative strength is weakening versus current scan opportunities.',
            signals: buildSignals(asset, asset.reason),
            targetPrice: buyIdea?.targetPrice || 0,
            expectedReturn: buyIdea?.expectedReturn || 0,
        };
    });
};

const Discovery = () => {
    const [thresholds, setThresholds] = useState(() => {
        const saved = safeParse(localStorage.getItem(THRESHOLDS_STORAGE_KEY), null);
        return saved || DEFAULT_THRESHOLDS;
    });
    const [strategyPresets, setStrategyPresets] = useState(FALLBACK_STRATEGY_PRESETS);
    const [strategyCatalogSource, setStrategyCatalogSource] = useState('fallback');

    const [activeStrategy, setActiveStrategy] = useState(() => {
        const saved = safeParse(localStorage.getItem(DISCOVERY_STATE_STORAGE_KEY), null);
        return normalizeStrategyId(saved?.strategyId || 'custom');
    });

    const [scanData, setScanData] = useState(() => {
        const saved = safeParse(localStorage.getItem(DISCOVERY_STATE_STORAGE_KEY), null);
        return saved?.data || null;
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showThresholds, setShowThresholds] = useState(false);
    const [thresholdModalKey, setThresholdModalKey] = useState(0);
    const [scanProgress, setScanProgress] = useState({ percent: 0, message: '' });
    const [watchlistTickers, setWatchlistTickers] = useState(() => {
        return new Set(readWatchlist().map((item) => normalizeTicker(item.ticker)));
    });
    const [expandedReplacements, setExpandedReplacements] = useState({});

    const strategyLookup = useMemo(() => {
        return strategyPresets.reduce((acc, strategy) => {
            acc[strategy.id] = strategy;
            return acc;
        }, {});
    }, [strategyPresets]);

    const fallbackStrategyConfig = strategyLookup.custom || strategyPresets[0] || FALLBACK_STRATEGY_PRESETS[0];
    const activeStrategyConfig = strategyLookup[activeStrategy] || fallbackStrategyConfig;

    useEffect(() => {
        document.documentElement.classList.add('discovery-theme');
        document.body.classList.add('discovery-theme');
        return () => {
            document.documentElement.classList.remove('discovery-theme');
            document.body.classList.remove('discovery-theme');
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const hydrateStrategyCatalog = async () => {
            try {
                const payload = await fetchDiscoveryStrategies();
                const mapped = mapBackendStrategies(payload?.strategies);
                if (!cancelled && mapped.length > 0) {
                    setStrategyPresets(mapped);
                    setStrategyCatalogSource('backend');
                    setActiveStrategy((previous) => (
                        mapped.some((strategy) => strategy.id === previous)
                            ? previous
                            : mapped[0].id
                    ));
                }
            } catch (fetchError) {
                console.warn('Discovery strategy catalog unavailable, using fallback presets.', fetchError);
                if (!cancelled) {
                    setStrategyCatalogSource('fallback');
                }
            }
        };
        hydrateStrategyCatalog();
        return () => {
            cancelled = true;
        };
    }, []);

    const syncWatchlist = useCallback(() => {
        setWatchlistTickers(new Set(readWatchlist().map((item) => normalizeTicker(item.ticker))));
    }, []);

    useEffect(() => {
        const handleUpdate = () => syncWatchlist();
        window.addEventListener(WATCHLIST_UPDATED_EVENT, handleUpdate);
        return () => window.removeEventListener(WATCHLIST_UPDATED_EVENT, handleUpdate);
    }, [syncWatchlist]);

    const persistDiscoveryState = useCallback((strategyId, data) => {
        localStorage.setItem(
            DISCOVERY_STATE_STORAGE_KEY,
            JSON.stringify({
                strategyId,
                data,
                updatedAt: new Date().toISOString(),
            })
        );
    }, []);

    const runAsyncDefaultScan = useCallback(async (strategyId, thresholdSet) => {
        setScanProgress({ percent: 0, message: 'Initializing async scan...' });
        const trigger = await triggerAsyncDiscoveryScan('IN', normalizeStrategyId(strategyId), thresholdSet);
        const jobId = trigger?.job_id;
        if (!jobId) {
            throw new Error('Async scan did not return a job id');
        }

        for (let attempt = 0; attempt < 45; attempt += 1) {
            const status = await getAsyncDiscoveryStatus(jobId);
            setScanProgress({
                percent: Math.max(0, status?.percent || 0),
                message: status?.message || 'Scanning...',
            });

            if (status?.state === 'FAILURE') {
                throw new Error(status?.error || status?.message || 'Async scan failed');
            }

            if (status?.state === 'SUCCESS' || status?.result_ready) {
                const results = await getAsyncDiscoveryResults(jobId);
                if (!results || !Array.isArray(results.scan_results)) {
                    throw new Error('Async scan returned an invalid response');
                }
                return results;
            }

            await sleep(1500);
        }

        throw new Error('Async scan timed out');
    }, []);

    const runScan = useCallback(async (strategyId, thresholdSet) => {
        const normalizedStrategy = normalizeStrategyId(strategyId);
        const effectiveThresholds = getEffectiveThresholds(strategyId, thresholdSet);
        const tryAsync = normalizedStrategy === 'custom' && isDefaultThresholds(effectiveThresholds);

        if (tryAsync) {
            try {
                return await runAsyncDefaultScan(normalizedStrategy, effectiveThresholds);
            } catch (asyncError) {
                console.warn('Async scan failed, falling back to sync scan:', asyncError);
                setScanProgress({ percent: 0, message: 'Async worker unavailable. Running direct scan...' });
            }
        }

        try {
            const syncData = await fetchDiscoveryScan(normalizedStrategy, effectiveThresholds);
            if (!syncData || !Array.isArray(syncData.scan_results)) {
                throw new Error('Scan response is invalid');
            }
            return syncData;
        } catch (syncError) {
            const canFallbackToAsync = !tryAsync;
            if (canFallbackToAsync) {
                try {
                    setScanProgress({ percent: 0, message: 'Direct scan failed. Retrying with async worker...' });
                    return await runAsyncDefaultScan(normalizedStrategy, effectiveThresholds);
                } catch {
                    // Continue and throw original sync error.
                }
            }
            throw syncError;
        }
    }, [runAsyncDefaultScan]);

    const handleScan = useCallback(async (strategyId = activeStrategy, thresholdSet = thresholds) => {
        const normalizedStrategy = normalizeStrategyId(strategyId);
        try {
            setLoading(true);
            setError(null);
            setScanProgress({ percent: 0, message: 'Starting market scan...' });
            setExpandedReplacements({});

            const data = await runScan(normalizedStrategy, thresholdSet);
            setScanData(data);
            persistDiscoveryState(normalizedStrategy, data);
        } catch (scanError) {
            console.error('Discovery scan error:', scanError);
            setError(resolveDiscoveryErrorMessage(scanError));
        } finally {
            setLoading(false);
            setScanProgress({ percent: 0, message: '' });
        }
    }, [activeStrategy, thresholds, runScan, persistDiscoveryState]);

    const handleApplyThresholds = (newThresholds) => {
        setThresholds(newThresholds);
        localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(newThresholds));
        setActiveStrategy('custom');
        setError(null);
        setScanProgress({ percent: 0, message: '' });
        setScanData(null);
        persistDiscoveryState('custom', null);
    };

    const handleSelectStrategy = (strategyId) => {
        const normalizedStrategy = normalizeStrategyId(strategyId);
        setActiveStrategy(normalizedStrategy);
        setError(null);
        setScanProgress({ percent: 0, message: '' });
        setScanData(null);
        setExpandedReplacements({});
        persistDiscoveryState(normalizedStrategy, null);
    };

    const openThresholdsModal = () => {
        setThresholdModalKey((prev) => prev + 1);
        setShowThresholds(true);
    };

    const ideas = useMemo(() => {
        const source = Array.isArray(scanData?.scan_results) ? scanData.scan_results : [];
        return source.map((stock) => {
            const currentPrice = Number(stock.price || 0);
            const upsidePotential = Number(stock.upside_potential || 0);
            const modeledUpside = upsidePotential > 0 ? upsidePotential : Math.max((Number(stock.score || 0) - 50) / 2, 3);
            const targetPrice = currentPrice * (1 + modeledUpside / 100);
            return {
                ticker: normalizeTicker(stock.ticker),
                name: normalizeTicker(stock.ticker),
                sector: stock.sector || 'Market Signal',
                currentPrice,
                targetPrice,
                expectedReturn: modeledUpside,
                momentum: Number(stock.momentum_score || 0),
                score: Number(stock.score || 0),
            };
        });
    }, [scanData]);

    const replacementRanking = useMemo(() => buildReplacementRanking(scanData, ideas), [scanData, ideas]);

    const activeStrategyLabel = activeStrategyConfig?.label || 'Custom Thresholds';
    const scanStrategyLabel = scanData?.strategy_metadata?.strategy_label || activeStrategyLabel;
    const scanSeconds = Number(scanData?.scan_metadata?.scan_time_seconds);

    const toggleWatchlist = (idea) => {
        if (watchlistTickers.has(idea.ticker)) {
            removeWatchlistItem(idea.ticker);
        } else {
            upsertWatchlistItem({
                ticker: idea.ticker,
                name: idea.name,
                strategy: activeStrategy,
                source: activeStrategyLabel,
                sector: idea.sector,
                currentPrice: idea.currentPrice,
                targetPrice: idea.targetPrice,
                expectedReturn: idea.expectedReturn,
                score: idea.score,
                momentum: idea.momentum,
            });
        }
    };

    const toggleReplacementExpansion = (key) => {
        setExpandedReplacements((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    return (
        <div className="discovery-native-page">
            <ThresholdsModal
                key={thresholdModalKey}
                isOpen={showThresholds}
                onClose={() => setShowThresholds(false)}
                onApply={handleApplyThresholds}
                initialThresholds={thresholds}
            />

            <section className="discovery-tabs-card">
                <div className="strategy-tabs" role="tablist" aria-label="Strategy tabs">
                    {strategyPresets.map((strategy) => (
                        <button
                            key={strategy.id}
                            type="button"
                            role="tab"
                            aria-selected={activeStrategy === strategy.id}
                            className={`strategy-tab ${activeStrategy === strategy.id ? 'active' : ''}`}
                            onClick={() => handleSelectStrategy(strategy.id)}
                        >
                            {strategy.label}
                        </button>
                    ))}
                </div>
                <div className={`strategy-source-chip ${strategyCatalogSource === 'backend' ? 'live' : 'fallback'}`}>
                    {strategyCatalogSource === 'backend' ? 'Live backend strategy catalog' : 'Fallback strategy catalog'}
                </div>
            </section>

            <section className="strategy-panel-card">
                <div className="strategy-panel-head">
                    <div>
                        <h2>{activeStrategyConfig.label}</h2>
                        <p>{activeStrategyConfig.description}</p>
                    </div>
                    {activeStrategy !== 'custom' && (
                        <button
                            type="button"
                            className="discovery-action-btn primary"
                            onClick={() => handleScan(activeStrategy, thresholds)}
                            disabled={loading}
                            title="Run strategy scan"
                        >
                            <RefreshCw size={17} className={loading ? 'spin' : ''} />
                            <span>{loading ? 'Scanning...' : 'Scan Now'}</span>
                        </button>
                    )}
                </div>

                {activeStrategy === 'custom' ? (
                    <div className="custom-controls-row">
                        <button
                            type="button"
                            className="discovery-action-btn subtle"
                            onClick={openThresholdsModal}
                            disabled={loading}
                            title="Edit custom thresholds"
                        >
                            <Settings size={17} />
                            <span>Thresholds</span>
                        </button>
                        <button
                            type="button"
                            className="discovery-action-btn primary"
                            onClick={() => handleScan('custom', thresholds)}
                            disabled={loading}
                            title="Run custom scan"
                        >
                            <RefreshCw size={17} className={loading ? 'spin' : ''} />
                            <span>{loading ? 'Scanning...' : 'Scan Now'}</span>
                        </button>
                    </div>
                ) : null}

                <div className="strategy-summary">
                    <Sparkles size={15} />
                    <span>Screening Logic</span>
                </div>
                <ul className="strategy-details-list">
                    {(activeStrategyConfig?.details || []).map((detail) => (
                        <li key={detail}>{detail}</li>
                    ))}
                </ul>
                {scanData ? (
                    <div className="scan-meta-strip">
                        <span>Engine: {scanStrategyLabel}</span>
                        {Number.isFinite(scanSeconds) ? <span>Scan: {scanSeconds.toFixed(1)}s</span> : null}
                        <span>Strategy ID: {(scanData?.strategy || activeStrategy || 'custom').toString()}</span>
                    </div>
                ) : null}
            </section>

            {loading && (
                <section className="discovery-status-card">
                    <div className="spinner"></div>
                    <p>{scanProgress.message || 'Scanning market opportunities...'}</p>
                    {scanProgress.percent > 0 && <p className="muted">Progress: {scanProgress.percent}%</p>}
                </section>
            )}

            {!loading && error && (
                <section className="discovery-status-card error">
                    <p>{error}</p>
                </section>
            )}

            {!loading && !error && !scanData && (
                <section className="discovery-status-card">
                    <CheckCircle2 size={20} />
                    <p>Select a strategy and run scan to generate recommendations.</p>
                </section>
            )}

            {!loading && !error && scanData && (
                <>
                    <section className="ideas-section">
                        <div className="section-head">
                            <h2>Investment Ideas</h2>
                            <span>{ideas.length} candidates</span>
                        </div>
                        <div className="idea-cards-grid">
                            {ideas.map((idea) => {
                                const added = watchlistTickers.has(idea.ticker);
                                return (
                                    <article className="idea-card" key={idea.ticker}>
                                        <div className="idea-card-top">
                                            <div className="idea-name-wrap">
                                                <h3 title={idea.ticker}>{idea.ticker}</h3>
                                                <p>{idea.sector}</p>
                                            </div>
                                            <span className={`idea-return ${idea.expectedReturn >= 0 ? 'positive' : 'negative'}`}>
                                                {percentSigned(idea.expectedReturn)}
                                            </span>
                                        </div>

                                        <div className="idea-pricing-grid">
                                            <div>
                                                <span>Current</span>
                                                <strong>{currency(idea.currentPrice)}</strong>
                                            </div>
                                            <div>
                                                <span>Target (30D)</span>
                                                <strong>{currency(idea.targetPrice)}</strong>
                                            </div>
                                        </div>

                                        <div className="idea-meta">
                                            <button
                                                type="button"
                                                className="metric-chip"
                                                title="Score = engine conviction after combining momentum, quality, and upside filters."
                                                aria-label="Score meaning"
                                            >
                                                <TrendingUp size={14} />
                                                Score {idea.score.toFixed(0)}
                                                <Info size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                className="metric-chip"
                                                title="Momentum = trend strength proxy derived from RSI and short-term technical acceleration."
                                                aria-label="Momentum meaning"
                                            >
                                                <Target size={14} />
                                                Momentum {idea.momentum.toFixed(0)}
                                                <Info size={12} />
                                            </button>
                                        </div>

                                        <button
                                            type="button"
                                            className={`idea-watchlist-btn ${added ? 'added' : ''}`}
                                            onClick={() => toggleWatchlist(idea)}
                                        >
                                            {added ? <Check size={15} /> : <Plus size={15} />}
                                            {added ? 'Added to Watchlist' : 'Add to Watchlist'}
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    </section>

                    <section className="replacement-section">
                        <div className="section-head">
                            <h2>Replacement Stock Ranking</h2>
                            <span>{replacementRanking.length} switches</span>
                        </div>
                        {replacementRanking.length === 0 ? (
                            <p className="muted">No replacement suggestions available yet.</p>
                        ) : (
                            <div className="replacement-list">
                                {replacementRanking.map((item) => {
                                    const itemKey = `${item.rank}-${item.fromTicker}-${item.toTicker}`;
                                    const expanded = Boolean(expandedReplacements[itemKey]);
                                    return (
                                        <article className={`replacement-item ${expanded ? 'expanded' : 'collapsed'}`} key={itemKey}>
                                            <div className="replacement-top">
                                                <span className="replacement-rank">#{item.rank}</span>
                                                <div className="replacement-route">
                                                    <strong>Sell {item.fromTicker}</strong>
                                                    <ArrowRightLeft size={14} />
                                                    <strong>Buy {item.toTicker}</strong>
                                                </div>
                                                <span className="replacement-upside">{percentSigned(item.expectedReturn)}</span>
                                                <button
                                                    type="button"
                                                    className="replacement-toggle-btn"
                                                    aria-label={expanded ? 'Collapse replacement details' : 'Expand replacement details'}
                                                    aria-expanded={expanded}
                                                    onClick={() => toggleReplacementExpansion(itemKey)}
                                                >
                                                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                </button>
                                            </div>
                                            {expanded ? (
                                                <>
                                                    <p className="replacement-reason">{item.switchReason}</p>
                                                    <ul className="replacement-signals">
                                                        {item.signals.slice(0, 4).map((signal) => (
                                                            <li key={signal}>
                                                                <CircleAlert size={13} />
                                                                <span>{signal}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    <div className="replacement-target">
                                                        Suggested 30D target for {item.toTicker}: <strong>{currency(item.targetPrice)}</strong>
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="replacement-collapsed-hint">Tap to view replacement rationale</p>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
};

export default Discovery;
