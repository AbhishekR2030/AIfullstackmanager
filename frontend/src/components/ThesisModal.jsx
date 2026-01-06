import React from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';
import './ThesisModal.css';

const ThesisModal = ({ isOpen, onClose, data, ticker, isLoading }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-container card">
                <div className="modal-header">
                    <h2>Analysis: {ticker.replace('.NS', '')}</h2>
                    <button className="btn-icon" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                <div className="modal-body">
                    {isLoading ? (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Consulting the Analyst Engine via Gemini 1.5...</p>
                            <p className="text-muted text-sm">This may take up to 15 seconds.</p>
                        </div>
                    ) : data ? (
                        <div className="thesis-content">
                            <div className="recommendation-badge" data-type={data.recommendation.toLowerCase()}>
                                {data.recommendation}
                            </div>

                            <div className="confidence-meter">
                                <div className="label">Confidence Score</div>
                                <div className="bar-bg">
                                    <div
                                        className="bar-fill"
                                        style={{ width: `${data.confidence_score}%` }}
                                    ></div>
                                </div>
                                <div className="score">{data.confidence_score}/100</div>
                            </div>

                            <div className="section">
                                <h3>Investment Thesis</h3>
                                <ul className="thesis-list">
                                    {data.thesis.map((point, i) => (
                                        <li key={i}>
                                            <CheckCircle size={16} className="text-success checkbox-icon" />
                                            <span>{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="section">
                                <h3>Risk Factors</h3>
                                <ul className="risk-list">
                                    {data.risk_factors.map((point, i) => (
                                        <li key={i}>
                                            <AlertTriangle size={16} className="text-danger checkbox-icon" />
                                            <span>{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ) : (
                        <div className="error-state">
                            <p>Failed to load analysis.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ThesisModal;
