import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'token';
const EMAIL_KEY = 'userEmail';

const isNative = () => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

const persistPreference = async (key, value) => {
    if (!isNative()) return;
    try {
        if (value === null || value === undefined || value === '') {
            await Preferences.remove({ key });
            return;
        }
        await Preferences.set({ key, value });
    } catch (err) {
        console.warn(`Failed to persist preference ${key}`, err);
    }
};

export const persistAuth = async (token, email = '') => {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }

    if (email) {
        localStorage.setItem(EMAIL_KEY, email);
    } else {
        localStorage.removeItem(EMAIL_KEY);
    }

    await Promise.all([
        persistPreference(TOKEN_KEY, token),
        persistPreference(EMAIL_KEY, email),
    ]);
};

export const clearAuth = async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);

    await Promise.all([
        persistPreference(TOKEN_KEY, ''),
        persistPreference(EMAIL_KEY, ''),
    ]);
};

export const restoreAuth = async () => {
    const existingToken = localStorage.getItem(TOKEN_KEY);
    const existingEmail = localStorage.getItem(EMAIL_KEY);

    if (existingToken) {
        return { token: existingToken, email: existingEmail || '' };
    }

    if (!isNative()) {
        return { token: null, email: null };
    }

    try {
        const [{ value: token }, { value: email }] = await Promise.all([
            Preferences.get({ key: TOKEN_KEY }),
            Preferences.get({ key: EMAIL_KEY }),
        ]);

        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        }
        if (email) {
            localStorage.setItem(EMAIL_KEY, email);
        }

        return { token: token || null, email: email || null };
    } catch (err) {
        console.warn('Failed to restore auth from native storage', err);
        return { token: null, email: null };
    }
};
