const PENDING_ZERODHA_CALLBACK_KEY = 'pendingZerodhaCallback';

const CALLBACK_KEYS = ['status', 'broker', 'error', 'expires_at', 'action'];

export const hasZerodhaCallbackParams = (params) => {
    if (!params) {
        return false;
    }

    const broker = (params.get('broker') || '').trim().toLowerCase();
    if (broker !== 'zerodha') {
        return false;
    }

    return CALLBACK_KEYS.some((key) => params.has(key));
};

export const persistPendingZerodhaCallback = (params) => {
    if (!hasZerodhaCallbackParams(params)) {
        return;
    }

    const payload = {};
    CALLBACK_KEYS.forEach((key) => {
        if (params.has(key)) {
            payload[key] = params.get(key) || '';
        }
    });

    localStorage.setItem(PENDING_ZERODHA_CALLBACK_KEY, JSON.stringify(payload));
};

export const consumePendingZerodhaCallback = () => {
    const raw = localStorage.getItem(PENDING_ZERODHA_CALLBACK_KEY);
    if (!raw) {
        return null;
    }

    localStorage.removeItem(PENDING_ZERODHA_CALLBACK_KEY);

    try {
        const payload = JSON.parse(raw);
        const params = new URLSearchParams();
        Object.entries(payload || {}).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).length > 0) {
                params.set(key, String(value));
            }
        });
        return params;
    } catch {
        return null;
    }
};
