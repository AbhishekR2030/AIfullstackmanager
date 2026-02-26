const PENDING_HDFC_CALLBACK_KEY = 'pendingHdfcCallback';

const CALLBACK_KEYS = ['request_token', 'requestToken', 'code', 'hdfc_status', 'error'];

export const hasHdfcCallbackParams = (params) => {
    if (!params) {
        return false;
    }

    return CALLBACK_KEYS.some((key) => params.has(key));
};

export const persistPendingHdfcCallback = (params) => {
    if (!hasHdfcCallbackParams(params)) {
        return;
    }

    const payload = {};
    CALLBACK_KEYS.forEach((key) => {
        if (params.has(key)) {
            payload[key] = params.get(key) || '';
        }
    });
    localStorage.setItem(PENDING_HDFC_CALLBACK_KEY, JSON.stringify(payload));
};

export const consumePendingHdfcCallback = () => {
    const raw = localStorage.getItem(PENDING_HDFC_CALLBACK_KEY);
    if (!raw) {
        return null;
    }

    localStorage.removeItem(PENDING_HDFC_CALLBACK_KEY);

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
