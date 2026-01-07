import React, { useEffect, useState, useRef } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchPortfolioHistory, getPortfolio } from '../services/api';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const Dashboard = () => {
    const [history, setHistory] = useState(null);
    const [portfolio, setPortfolio] = useState([]); // Store holding details
    const [summary, setSummary] = useState({ totalValue: 0, totalReturn: 0, totalReturnPercent: 0 });
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState('1y');
    const [chartMode, setChartMode] = useState('percent');

    useEffect(() => {
        loadData();
    }, [timeRange]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Fetch History
            const histData = await fetchPortfolioHistory(timeRange);
            setHistory(histData);

            // Fetch Current Summary & Holdings
            const portfolioData = await getPortfolio();
            setPortfolio(portfolioData); // Save for table

            const totalVal = portfolioData.reduce((acc, curr) => acc + (curr.total_value || 0), 0);
            const totalInv = portfolioData.reduce((acc, curr) => acc + (curr.buy_price * curr.quantity), 0);
            const totalRet = totalVal - totalInv;
            const totalRetPct = totalInv ? (totalRet / totalInv) * 100 : 0;

            setSummary({
                totalValue: totalVal,
                totalReturn: totalRet,
                totalReturnPercent: totalRetPct
            });

        } catch (error) {
            console.error("Dashboard Load Error:", error);
            setSummary(prev => ({ ...prev, error: error.message + (error.response ? ` (${error.response.status})` : '') }));
        } finally {
            setLoading(false);
        }
    };

    // ... (rest of chart logic) ...


    // Chart Data Preparation
    const getChartData = () => {
        if (!history || !history.dates || history.dates.length === 0) return null;

        const labels = history.dates;
        let datasetData = [];
        let label = '';
        let borderColor = '#3b82f6';
        let backgroundColor = 'rgba(59, 130, 246, 0.1)';

        if (chartMode === 'value') {
            datasetData = history.portfolio_value;
            label = 'Portfolio Value (₹)';
        } else {
            // Calculate % Return over time based on Invested Amount at that time
            datasetData = history.portfolio_value.map((v, i) => {
                const invested = history.invested_value[i];
                if (!invested) return 0;
                return ((v - invested) / invested) * 100;
            });
            label = 'Portfolio Return (%)';

            // Color coding for returns (Dynamic based on latest value or overall trend?)
            // If the latest value is negative, show Red. Else Green.
            const currentReturn = datasetData[datasetData.length - 1];
            if (currentReturn < 0) {
                borderColor = '#ef4444'; // Red
                backgroundColor = 'rgba(239, 68, 68, 0.1)';
            } else {
                borderColor = '#10b981'; // Green
                backgroundColor = 'rgba(16, 185, 129, 0.1)';
            }
        }

        return {
            labels,
            datasets: [
                {
                    label,
                    data: datasetData,
                    borderColor: '#3b82f6', // Fallback
                    backgroundColor: 'rgba(59, 130, 246, 0.1)', // Fallback
                    segment: {
                        borderColor: ctx => {
                            // If in Percent mode, color based on zero-crossing
                            if (chartMode === 'percent') {
                                return ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0 ? '#ef4444' : '#10b981';
                            }
                            return '#3b82f6'; // Value mode default
                        },
                        backgroundColor: ctx => {
                            if (chartMode === 'percent') {
                                return ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
                            }
                            return 'rgba(59, 130, 246, 0.1)';
                        }
                    },
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                },
            ],
        };
    };

    // ... options ... 
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: (context) => {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (chartMode === 'value') {
                            label += '₹' + context.parsed.y.toLocaleString();
                        } else {
                            label += context.parsed.y.toFixed(2) + '%';
                        }
                        return label;
                    }
                }
            },
        },
        scales: {
            x: {
                grid: {
                    display: false,
                    drawBorder: false,
                },
                ticks: {
                    maxTicksLimit: 6, // Don't crowd x-axis
                    color: '#6b7280'
                }
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)',
                    drawBorder: false,
                },
                ticks: {
                    color: '#6b7280',
                    callback: (value) => chartMode === 'value' ? '₹' + value.toLocaleString() : value + '%'
                }
            },
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    };

    const totalInvested = portfolio.reduce((acc, curr) => acc + (curr.buy_price * curr.quantity), 0);

    return (
        <div className="dashboard-page">
            <div className="dashboard-header">
                <h1>Portfolio Analysis</h1>
                <p className="text-muted">Overview of your wealth performance.</p>
            </div>

            {/* KPI Cards */}
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="kpi-card">
                    <h3>Net Worth</h3>
                    <div className="value">₹{summary.totalValue.toLocaleString()}</div>
                </div>
                <div className="kpi-card">
                    <h3>Invested Value</h3>
                    <div className="value">₹{totalInvested.toLocaleString()}</div>
                </div>
                <div className="kpi-card">
                    <h3>Total Return</h3>
                    <div className={`value ${summary.totalReturn >= 0 ? 'text-success' : 'text-danger'}`}>
                        {summary.totalReturn >= 0 ? '+' : ''}₹{Math.abs(summary.totalReturn).toLocaleString()}
                        <span className="sub-value">({summary.totalReturnPercent.toFixed(2)}%)</span>
                    </div>
                </div>
            </div>

            {/* Main Chart Section */}
            <div className="chart-container-card">
                <div className="chart-header">
                    <h2>Portfolio Growth</h2>
                    <div className="chart-controls">
                        {/* Mode Toggle */}
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${chartMode === 'percent' ? 'active' : ''}`}
                                onClick={() => setChartMode('percent')}
                            >
                                % Return
                            </button>
                            <button
                                className={`toggle-btn ${chartMode === 'value' ? 'active' : ''}`}
                                onClick={() => setChartMode('value')}
                            >
                                Value
                            </button>
                        </div>

                        {/* Time Range */}
                        <div className="time-group">
                            {['1mo', '3mo', '6mo', '1y', 'ytd', 'all'].map((range) => (
                                <button
                                    key={range}
                                    className={`time-btn ${timeRange === range ? 'active' : ''}`}
                                    onClick={() => setTimeRange(range)}
                                >
                                    {range.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="chart-wrapper">
                    {loading ? (
                        <div className="loading-chart">Loading Chart...</div>
                    ) : history && history.dates.length > 0 ? (
                        <Line data={getChartData()} options={options} />
                    ) : (
                        <div className="empty-chart">Not enough data to display chart. Add older trades to see history.</div>
                    )}
                </div>
            </div>

            {/* Holdings Section */}
            <div className="dashboard-section mt-4">
                <h2 className="section-title">Your Assets</h2>
                <div className="table-card">
                    <table className="portfolio-table">
                        <thead>
                            <tr>
                                <th>Ticker</th>
                                <th>Qty</th>
                                <th>Avg. Price</th>
                                <th>Current Price</th>
                                <th>Value</th>
                                <th>Return</th>
                            </tr>
                        </thead>
                        <tbody>
                            {portfolio.length > 0 ? portfolio.map((trade, index) => (
                                <tr key={index}>
                                    <td className="fw-bold">{trade.ticker}</td>
                                    <td>{trade.quantity}</td>
                                    <td>₹{trade.buy_price}</td>
                                    <td>₹{trade.current_price}</td>
                                    <td>₹{trade.total_value}</td>
                                    <td className={trade.pl_percent >= 0 ? 'text-success' : 'text-danger'}>
                                        {trade.pl_percent >= 0 ? '+' : ''}{trade.pl_percent}%
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" className="text-center text-muted" style={{ padding: '2rem' }}>
                                        No assets found. Go to Portfolio to add trades.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
