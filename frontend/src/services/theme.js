const THEME_STORAGE_KEY = 'alphaseeker_theme';
export const THEME_UPDATED_EVENT = 'alphaseeker:theme-updated';

export const normalizeTheme = (value) => (value === 'dark' ? 'dark' : 'light');

export const getStoredTheme = () => {
    try {
        return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return 'light';
    }
};

export const applyTheme = (value) => {
    const theme = normalizeTheme(value);
    document.documentElement.setAttribute('data-app-theme', theme);
    document.body?.setAttribute('data-app-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent(THEME_UPDATED_EVENT, { detail: { theme } }));
    return theme;
};

export const initializeTheme = () => applyTheme(getStoredTheme());
