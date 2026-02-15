import React, { useMemo, useState } from 'react';
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

const cloneThresholds = (source) => ({
    technical: { ...source.technical },
    fundamental: { ...source.fundamental }
});

const normalizeValue = (value, fallback) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const RangeInput = ({
    label,
    unit = '',
    minValue,
    maxValue,
    onMinChange,
    onMaxChange,
    onMinBlur,
    onMaxBlur
}) => (
    <div className="threshold-row">
        <label className="threshold-label">{label} {unit && `(${unit})`}</label>
        <div className="threshold-inputs">
            <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                value={minValue}
                onChange={onMinChange}
                onBlur={onMinBlur}
                placeholder="Min"
            />
            <span className="range-separator">to</span>
            <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                value={maxValue}
                onChange={onMaxChange}
                onBlur={onMaxBlur}
                placeholder="Max"
            />
        </div>
    </div>
);

const ThresholdsModal = ({ isOpen, onClose, onApply, initialThresholds }) => {
    const initialState = useMemo(
        () => cloneThresholds(initialThresholds || DEFAULT_THRESHOLDS),
        [initialThresholds]
    );
    const [thresholds, setThresholds] = useState(initialState);

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
        if (val === '' || Number.isNaN(Number(val))) {
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
        setThresholds(cloneThresholds(DEFAULT_THRESHOLDS));
    };

    const handleApply = () => {
        // Ensure all values are numbers before applying
        const cleanThresholds = {
            technical: {},
            fundamental: {}
        };

        for (const [key, val] of Object.entries(thresholds.technical)) {
            cleanThresholds.technical[key] = normalizeValue(val, DEFAULT_THRESHOLDS.technical[key]);
        }
        for (const [key, val] of Object.entries(thresholds.fundamental)) {
            cleanThresholds.fundamental[key] = normalizeValue(val, DEFAULT_THRESHOLDS.fundamental[key]);
        }

        onApply(cleanThresholds);
        onClose();
    };

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
                            minValue={thresholds.technical.rsi_min}
                            maxValue={thresholds.technical.rsi_max}
                            onMinChange={(e) => handleChange('technical', 'rsi_min', e.target.value)}
                            onMaxChange={(e) => handleChange('technical', 'rsi_max', e.target.value)}
                            onMinBlur={() => handleBlur('technical', 'rsi_min')}
                            onMaxBlur={() => handleBlur('technical', 'rsi_max')}
                        />
                        <RangeInput
                            label="Volatility"
                            unit="%"
                            minValue={thresholds.technical.volatility_min}
                            maxValue={thresholds.technical.volatility_max}
                            onMinChange={(e) => handleChange('technical', 'volatility_min', e.target.value)}
                            onMaxChange={(e) => handleChange('technical', 'volatility_max', e.target.value)}
                            onMinBlur={() => handleBlur('technical', 'volatility_min')}
                            onMaxBlur={() => handleBlur('technical', 'volatility_max')}
                        />
                        <RangeInput
                            label="Volume Shock"
                            unit="x"
                            minValue={thresholds.technical.volume_shock_min}
                            maxValue={thresholds.technical.volume_shock_max}
                            onMinChange={(e) => handleChange('technical', 'volume_shock_min', e.target.value)}
                            onMaxChange={(e) => handleChange('technical', 'volume_shock_max', e.target.value)}
                            onMinBlur={() => handleBlur('technical', 'volume_shock_min')}
                            onMaxBlur={() => handleBlur('technical', 'volume_shock_max')}
                        />
                    </div>

                    {/* Fundamental Section */}
                    <div className="threshold-section">
                        <h3 className="section-heading">Fundamental Parameters</h3>
                        <RangeInput
                            label="Revenue Growth"
                            unit="%"
                            minValue={thresholds.fundamental.revenue_growth_min}
                            maxValue={thresholds.fundamental.revenue_growth_max}
                            onMinChange={(e) => handleChange('fundamental', 'revenue_growth_min', e.target.value)}
                            onMaxChange={(e) => handleChange('fundamental', 'revenue_growth_max', e.target.value)}
                            onMinBlur={() => handleBlur('fundamental', 'revenue_growth_min')}
                            onMaxBlur={() => handleBlur('fundamental', 'revenue_growth_max')}
                        />
                        <RangeInput
                            label="Profit Growth"
                            unit="%"
                            minValue={thresholds.fundamental.profit_growth_min}
                            maxValue={thresholds.fundamental.profit_growth_max}
                            onMinChange={(e) => handleChange('fundamental', 'profit_growth_min', e.target.value)}
                            onMaxChange={(e) => handleChange('fundamental', 'profit_growth_max', e.target.value)}
                            onMinBlur={() => handleBlur('fundamental', 'profit_growth_min')}
                            onMaxBlur={() => handleBlur('fundamental', 'profit_growth_max')}
                        />
                        <RangeInput
                            label="ROE"
                            unit="%"
                            minValue={thresholds.fundamental.roe_min}
                            maxValue={thresholds.fundamental.roe_max}
                            onMinChange={(e) => handleChange('fundamental', 'roe_min', e.target.value)}
                            onMaxChange={(e) => handleChange('fundamental', 'roe_max', e.target.value)}
                            onMinBlur={() => handleBlur('fundamental', 'roe_min')}
                            onMaxBlur={() => handleBlur('fundamental', 'roe_max')}
                        />
                        <RangeInput
                            label="ROCE"
                            unit="%"
                            minValue={thresholds.fundamental.roce_min}
                            maxValue={thresholds.fundamental.roce_max}
                            onMinChange={(e) => handleChange('fundamental', 'roce_min', e.target.value)}
                            onMaxChange={(e) => handleChange('fundamental', 'roce_max', e.target.value)}
                            onMinBlur={() => handleBlur('fundamental', 'roce_min')}
                            onMaxBlur={() => handleBlur('fundamental', 'roce_max')}
                        />
                        <RangeInput
                            label="Debt/Equity"
                            unit="%"
                            minValue={thresholds.fundamental.debt_equity_min}
                            maxValue={thresholds.fundamental.debt_equity_max}
                            onMinChange={(e) => handleChange('fundamental', 'debt_equity_min', e.target.value)}
                            onMaxChange={(e) => handleChange('fundamental', 'debt_equity_max', e.target.value)}
                            onMinBlur={() => handleBlur('fundamental', 'debt_equity_min')}
                            onMaxBlur={() => handleBlur('fundamental', 'debt_equity_max')}
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
