const PORTFOLIO_CACHE_KEY = 'alphaseeker:portfolio:v1';
const PORTFOLIO_HISTORY_CACHE_PREFIX = 'alphaseeker:portfolio-history:v1:';
export const PORTFOLIO_UPDATED_EVENT = 'alphaseeker:portfolio-updated';

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const parseJson = (rawValue, fallback) => {
    if (!rawValue) {
        return fallback;
    }
    try {
        return JSON.parse(rawValue);
    } catch {
        return fallback;
    }
};

const writeJson = (key, value) => {
    if (!canUseStorage()) {
        return;
    }
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Best effort cache only.
    }
};

export const summarizePortfolio = (portfolioItems = []) => {
    const totalValue = portfolioItems.reduce(
        (accumulator, item) => accumulator + (Number(item?.total_value) || 0),
        0
    );
    const totalInvested = portfolioItems.reduce(
        (accumulator, item) => accumulator + ((Number(item?.buy_price) || 0) * (Number(item?.quantity) || 0)),
        0
    );
    const totalReturn = totalValue - totalInvested;
    const totalReturnPercent = totalInvested ? (totalReturn / totalInvested) * 100 : 0;

    return {
        totalValue,
        totalInvested,
        totalReturn,
        totalReturnPercent,
    };
};

export const readPortfolioCache = () => {
    if (!canUseStorage()) {
        return { items: [], updatedAt: null };
    }

    const cachedPayload = parseJson(window.localStorage.getItem(PORTFOLIO_CACHE_KEY), null);
    if (!cachedPayload || !Array.isArray(cachedPayload.items)) {
        return { items: [], updatedAt: null };
    }

    return {
        items: cachedPayload.items,
        updatedAt: cachedPayload.updatedAt || null,
    };
};

export const writePortfolioCache = (items) => {
    writeJson(PORTFOLIO_CACHE_KEY, {
        items: Array.isArray(items) ? items : [],
        updatedAt: Date.now(),
    });
};

export const readPortfolioHistoryCache = (period = '1y') => {
    if (!canUseStorage()) {
        return null;
    }

    const cacheKey = `${PORTFOLIO_HISTORY_CACHE_PREFIX}${period}`;
    const cachedPayload = parseJson(window.localStorage.getItem(cacheKey), null);
    if (!cachedPayload || !cachedPayload.data) {
        return null;
    }

    return cachedPayload.data;
};

export const writePortfolioHistoryCache = (period = '1y', data = null) => {
    if (!data) {
        return;
    }

    const cacheKey = `${PORTFOLIO_HISTORY_CACHE_PREFIX}${period}`;
    writeJson(cacheKey, {
        data,
        updatedAt: Date.now(),
    });
};

export const emitPortfolioUpdated = (items) => {
    if (typeof window === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent(PORTFOLIO_UPDATED_EVENT, {
        detail: {
            items: Array.isArray(items) ? items : [],
            updatedAt: Date.now(),
        },
    }));
};
