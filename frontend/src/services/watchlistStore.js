const WATCHLIST_STORAGE_KEY = 'alphaseeker_watchlist';
export const WATCHLIST_UPDATED_EVENT = 'alphaseeker:watchlist-updated';

const normalizeTicker = (ticker) => (ticker || '').trim().toUpperCase();

const safeParse = (raw) => {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const persist = (items) => {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(WATCHLIST_UPDATED_EVENT, { detail: { items } }));
    return items;
};

export const readWatchlist = () => {
    return safeParse(localStorage.getItem(WATCHLIST_STORAGE_KEY));
};

export const upsertWatchlistItem = (item) => {
    const ticker = normalizeTicker(item?.ticker);
    if (!ticker) {
        return readWatchlist();
    }

    const nowIso = new Date().toISOString();
    const existing = readWatchlist();
    const index = existing.findIndex((entry) => normalizeTicker(entry.ticker) === ticker);

    const normalizedItem = {
        ticker,
        name: item?.name || ticker,
        strategy: item?.strategy || 'custom',
        source: item?.source || 'Discovery',
        sector: item?.sector || 'Unknown',
        currentPrice: Number(item?.currentPrice || 0),
        targetPrice: Number(item?.targetPrice || 0),
        expectedReturn: Number(item?.expectedReturn || 0),
        score: Number(item?.score || 0),
        momentum: Number(item?.momentum || 0),
        addedAt: nowIso,
        updatedAt: nowIso,
    };

    if (index >= 0) {
        const previous = existing[index];
        const next = [...existing];
        next[index] = {
            ...previous,
            ...normalizedItem,
            addedAt: previous.addedAt || normalizedItem.addedAt,
        };
        return persist(next);
    }

    return persist([normalizedItem, ...existing]);
};

export const removeWatchlistItem = (tickerToRemove) => {
    const ticker = normalizeTicker(tickerToRemove);
    if (!ticker) {
        return readWatchlist();
    }

    const next = readWatchlist().filter((entry) => normalizeTicker(entry.ticker) !== ticker);
    return persist(next);
};

export const isWatchlisted = (ticker) => {
    const normalized = normalizeTicker(ticker);
    return readWatchlist().some((entry) => normalizeTicker(entry.ticker) === normalized);
};
