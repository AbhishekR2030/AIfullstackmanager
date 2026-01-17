import React, { useState, useEffect } from 'react';
import { Settings, X, RotateCcw } from 'lucide-react';
import './ThresholdsModal.css';

const DEFAULT_THRESHOLDS = {
    technical: {
        rsi_min: 50,
        rsi_max: 70,
        volatility_min: 3,
        volatility_max: 8,
        volume_shock_min: 1.5,
        volume_shock_max: 5.0
    },
    fundamental: {
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
    }
};

const ThresholdsModal = ({ isOpen, onClose, onApply, initialThresholds }) => {
    const [thresholds, setThresholds] = useState(initialThresholds || DEFAULT_THRESHOLDS);

    // Sync with initialThresholds when modal opens
    useEffect(() => {
        if (isOpen && initialThresholds) {
            setThresholds(initialThresholds);
        }
    }, [isOpen, initialThresholds]);

    if (!isOpen) return null;

    const handleChange = (section, field, value) => {
        // Allow empty string for easier editing, parse on blur
        const numValue = value === '' ? '' : parseFloat(value);
        setThresholds(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [field]: numValue
            }
        }));
    };

    const handleBlur = (section, field) => {
        // Ensure valid number on blur
        const val = thresholds[section][field];
        if (val === '' || isNaN(val)) {
            const defaultVal = DEFAULT_THRESHOLDS[section][field];
            setThresholds(prev => ({
                ...prev,
                [section]: {
                    ...prev[section],
                    [field]: defaultVal
                }
            }));
        }
    };

    const handleReset = () => {
        setThresholds(DEFAULT_THRESHOLDS);
    };

    const handleApply = () => {
        // Ensure all values are numbers before applying
        const cleanThresholds = {
            technical: {},
            fundamental: {}
        };

        for (const [key, val] of Object.entries(thresholds.technical)) {
            cleanThresholds.technical[key] = parseFloat(val) || DEFAULT_THRESHOLDS.technical[key];
        }
        for (const [key, val] of Object.entries(thresholds.fundamental)) {
            cleanThresholds.fundamental[key] = parseFloat(val) || DEFAULT_THRESHOLDS.fundamental[key];
        }

        onApply(cleanThresholds);
        onClose();
    };

    const RangeInput = ({ label, section, minField, maxField, unit = '' }) => (
        <div className="threshold-row">
            <label className="threshold-label">{label} {unit && `(${unit})`}</label>
            <div className="threshold-inputs">
                <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={thresholds[section][minField]}
                    onChange={(e) => handleChange(section, minField, e.target.value)}
                    onBlur={() => handleBlur(section, minField)}
                    placeholder="Min"
                />
                <span className="range-separator">to</span>
                <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={thresholds[section][maxField]}
                    onChange={(e) => handleChange(section, maxField, e.target.value)}
                    onBlur={() => handleBlur(section, maxField)}
                    placeholder="Max"
                />
            </div>
        </div>
    );

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="thresholds-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2><Settings size={20} /> Screening Thresholds</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Technical Section */}
                    <div className="threshold-section">
                        <h3 className="section-heading">Technical Parameters</h3>
                        <RangeInput
                            label="RSI"
                            section="technical"
                            minField="rsi_min"
                            maxField="rsi_max"
                        />
                        <RangeInput
                            label="Volatility"
                            section="technical"
                            minField="volatility_min"
                            maxField="volatility_max"
                            unit="%"
                        />
                        <RangeInput
                            label="Volume Shock"
                            section="technical"
                            minField="volume_shock_min"
                            maxField="volume_shock_max"
                            unit="x"
                        />
                    </div>

                    {/* Fundamental Section */}
                    <div className="threshold-section">
                        <h3 className="section-heading">Fundamental Parameters</h3>
                        <RangeInput
                            label="Revenue Growth"
                            section="fundamental"
                            minField="revenue_growth_min"
                            maxField="revenue_growth_max"
                            unit="%"
                        />
                        <RangeInput
                            label="Profit Growth"
                            section="fundamental"
                            minField="profit_growth_min"
                            maxField="profit_growth_max"
                            unit="%"
                        />
                        <RangeInput
                            label="ROE"
                            section="fundamental"
                            minField="roe_min"
                            maxField="roe_max"
                            unit="%"
                        />
                        <RangeInput
                            label="ROCE"
                            section="fundamental"
                            minField="roce_min"
                            maxField="roce_max"
                            unit="%"
                        />
                        <RangeInput
                            label="Debt/Equity"
                            section="fundamental"
                            minField="debt_equity_min"
                            maxField="debt_equity_max"
                            unit="%"
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn-reset" onClick={handleReset}>
                        <RotateCcw size={16} /> Reset Defaults
                    </button>
                    <button className="btn-apply" onClick={handleApply}>
                        Apply & Scan
                    </button>
                </div>
            </div>
        </div>
    );
};

export { DEFAULT_THRESHOLDS };
export default ThresholdsModal;
