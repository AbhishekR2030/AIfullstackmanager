import React, { useEffect, useState } from 'react';
import { fetchScreenerResults, fetchAnalysis } from '../services/api';
import StockCard from '../components/StockCard';
import ThesisModal from '../components/ThesisModal';
import { Search } from 'lucide-react';
import './Discovery.css';

const Discovery = () => {
    const [stocks, setStocks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal State
    const [selectedStock, setSelectedStock] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [thesisData, setThesisData] = useState(null);
    const [isThesisLoading, setIsThesisLoading] = useState(false);

    useEffect(() => {
        loadStocks();
    }, []);

    const loadStocks = async () => {
        try {
            setLoading(true);
            const data = await fetchScreenerResults();
            setStocks(data.matches || []);
        } catch (err) {
            setError("Failed to load screener results. Is the backend running?");
        } finally {
            setLoading(false);
        }
    };

    const handleStockClick = async (stock) => {
        setSelectedStock(stock);
        setIsModalOpen(true);
        setThesisData(null);
        setIsThesisLoading(true);

        try {
            const data = await fetchAnalysis(stock.ticker);
            setThesisData(data);
        } catch (err) {
            console.error(err);
            // Keep modal open but show error inside? Or just log it.
        } finally {
            setIsThesisLoading(false);
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedStock(null);
    };

    return (
        <div className="discovery-page">
            <div className="discovery-header">
                <h1>Market Discovery</h1>
                <p className="text-muted">AI-powered screener for high-momentum Indian equities.</p>
            </div>

            {loading ? (
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Scanning the market...</p>
                </div>
            ) : error ? (
                <div className="error-container">
                    <p className="text-danger">{error}</p>
                    <button className="btn btn-primary" onClick={loadStocks}>Retry</button>
                </div>
            ) : (
                <div className="stocks-grid">
                    {stocks.map((stock) => (
                        <StockCard
                            key={stock.ticker}
                            stock={stock}
                            onClick={handleStockClick}
                        />
                    ))}
                </div>
            )}

            <ThesisModal
                isOpen={isModalOpen}
                onClose={closeModal}
                data={thesisData}
                ticker={selectedStock?.ticker || ''}
                isLoading={isThesisLoading}
            />
        </div>
    );
};

export default Discovery;
