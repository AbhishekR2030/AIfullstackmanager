import React, { useState } from 'react';
import { fetchDiscoveryScan, triggerAsyncDiscoveryScan, getAsyncDiscoveryStatus, getAsyncDiscoveryResults } from '../services/api';
import StockCard from '../components/StockCard';
import ThresholdsModal, { DEFAULT_THRESHOLDS } from '../components/ThresholdsModal';
import { RefreshCw, ArrowRight, TrendingUp, AlertTriangle, CheckCircle, Settings } from 'lucide-react';
import './Discovery.css';

// localStorage keys for persistent data
const THRESHOLDS_STORAGE_KEY = 'alphaseeker_discovery_thresholds';
const SCAN_RESULTS_STORAGE_KEY = 'alphaseeker_discovery_results';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const Discovery = () => {
    // Load scan results from localStorage on mount
    const [scanData, setScanData] = useState(() => {
        try {
            const saved = localStorage.getItem(SCAN_RESULTS_STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showThresholds, setShowThresholds] = useState(false);
    const [thresholdModalKey, setThresholdModalKey] = useState(0);
    const [scanProgress, setScanProgress] = useState({ percent: 0, message: '' });

    // Load thresholds from localStorage on mount
    const [thresholds, setThresholds] = useState(() => {
        try {
            const saved = localStorage.getItem(THRESHOLDS_STORAGE_KEY);
            return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
        } catch {
            return DEFAULT_THRESHOLDS;
        }
    });

    const loadData = async (customThresholds = thresholds) => {
        try {
            setLoading(true);
            setError(null);
            setScanProgress({ percent: 0, message: 'Initializing scan...' });

            // Async worker currently supports region-based scanning.
            // Keep sync endpoint for non-default custom threshold scans.
            const isDefaultThresholds = JSON.stringify(customThresholds) === JSON.stringify(DEFAULT_THRESHOLDS);
            let data;

            if (!isDefaultThresholds) {
                data = await fetchDiscoveryScan(customThresholds);
            } else {
                const trigger = await triggerAsyncDiscoveryScan('IN');
                const jobId = trigger.job_id;
                let completed = false;

                for (let attempt = 0; attempt < 150; attempt += 1) {
                    const status = await getAsyncDiscoveryStatus(jobId);
                    setScanProgress({
                        percent: Math.max(0, status.percent || 0),
                        message: status.message || 'Scanning...'
                    });

                    if (status.state === 'FAILURE') {
                        throw new Error(status.error || status.message || 'Async scan failed');
                    }

                    if (status.state === 'SUCCESS' || status.result_ready) {
                        data = await getAsyncDiscoveryResults(jobId);
                        completed = true;
                        break;
                    }

                    await sleep(2000);
                }

                if (!completed) {
                    throw new Error('Scan timed out. Please try again.');
                }
            }

            setScanData(data);
            // Persist scan results to localStorage
            localStorage.setItem(SCAN_RESULTS_STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
            console.error("Scan error:", err);
            setError(err?.message || "Failed to scan market. Server might be busy.");
        } finally {
            setLoading(false);
            setScanProgress({ percent: 0, message: '' });
        }
    };

    const handleApplyThresholds = (newThresholds) => {
        setThresholds(newThresholds);
        // Persist thresholds to localStorage
        localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(newThresholds));
        loadData(newThresholds);
    };

    const openThresholdsModal = () => {
        setThresholdModalKey((prev) => prev + 1);
        setShowThresholds(true);
    };

    return (
        <div className="discovery-page">
            <div className="discovery-header">
                <div>
                    <h1>Market Opportunities</h1>
                    <p className="text-muted">AI-Scanner: Nifty 500 Momentum, RSI & Volatility Check</p>
                </div>
                <div className="header-actions">
                    <button
                        className="btn-thresholds"
                        onClick={openThresholdsModal}
                        disabled={loading}
                    >
                        <Settings size={18} />
                        <span>Thresholds</span>
                    </button>
                    <button
                        className="btn-scan"
                        onClick={() => loadData()}
                        disabled={loading}
                    >
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                        <span>Scan Now</span>
                    </button>
                </div>
            </div>

            {/* Thresholds Modal */}
            <ThresholdsModal
                key={thresholdModalKey}
                isOpen={showThresholds}
                onClose={() => setShowThresholds(false)}
                onApply={handleApplyThresholds}
                initialThresholds={thresholds}
            />

            {loading ? (
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>{scanProgress.message || 'Scanning 500+ Assets & Analyzing Portfolio...'}</p>
                    {scanProgress.percent > 0 && (
                        <p className="text-muted">Progress: {scanProgress.percent}%</p>
                    )}
                </div>
            ) : error ? (
                <div className="error-container"><p className="text-danger">{error}</p></div>
            ) : !scanData ? (
                <div className="empty-state">
                    <Settings size={48} className="empty-icon" />
                    <h3>Configure Thresholds & Scan</h3>
                    <p>Click "Thresholds" to set your screening criteria, then "Scan Now" to find opportunities.</p>
                </div>
            ) : (
                <div className="scan-results-container">

                    {/* 1. Swap Opportunities (High Priority) with Ranking */}
                    {scanData.swap_opportunities && scanData.swap_opportunities.length > 0 && (
                        <div className="section-card highlight-section">
                            <h3 className="section-title"><AlertTriangle size={20} color="#f59e0b" /> Recommendation: Sell & Reinvest</h3>
                            <div className="swaps-grid">
                                {scanData.swap_opportunities.map((swap, idx) => (
                                    <div key={idx} className="swap-card">
                                        <div className="swap-priority">#{swap.priority}</div>
                                        <div className="swap-from">
                                            <span className="label">SELL</span>
                                            <span className="ticker text-danger">{swap.sell}</span>
                                        </div>
                                        <ArrowRight size={24} className="text-muted" />
                                        <div className="swap-to">
                                            <span className="label">BUY</span>
                                            <span className="ticker text-success">{swap.buy}</span>
                                        </div>
                                        <p className="swap-reason">{swap.reason}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 2. Top Buy Candidates */}
                    <div className="section-card">
                        <h3 className="section-title"><TrendingUp size={20} color="#10b981" /> Top Buy Candidates (Nifty 500)</h3>
                        <div className="stocks-grid">
                            {scanData.scan_results && scanData.scan_results.map((stock) => (
                                <StockCard key={stock.ticker} stock={stock} thresholds={thresholds} />
                            ))}
                        </div>
                        {(!scanData.scan_results || scanData.scan_results.length === 0) &&
                            <p className="text-muted">No strong buy signals found with current thresholds.</p>
                        }
                    </div>

                    {/* 3. Portfolio Health */}
                    {scanData.portfolio_analysis && scanData.portfolio_analysis.length > 0 && (
                        <div className="section-card">
                            <h3 className="section-title"><CheckCircle size={20} color="#3b82f6" /> Portfolio Health Check</h3>
                            <div className="portfolio-health-list">
                                {scanData.portfolio_analysis.map((asset, idx) => (
                                    <div key={idx} className={`health-item ${(asset.recommendation || '').toLowerCase()}`}>
                                        <div className="health-ticker">{asset.ticker}</div>
                                        <div className="health-badge">
                                            {(asset.recommendation || '').replace('_', ' ')}
                                        </div>
                                        <div className="health-details">
                                            Age: {asset.age_days || 0}d | Trend: {asset.trend}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
};

export default Discovery;
