import axios from 'axios';
import { Capacitor } from '@capacitor/core';

const resolveApiBaseUrl = () => {
    const configuredUrl = (import.meta.env.VITE_API_URL || '').trim();
    if (Capacitor.isNativePlatform()) {
        const nativeUrl = (import.meta.env.VITE_MOBILE_API_URL || '').trim();
        if (nativeUrl) {
            return nativeUrl;
        }
        if (configuredUrl) {
            return configuredUrl;
        }
        return 'https://alphaseeker-backend-s3pun44lha-uc.a.run.app/api/v1';
    }

    if (configuredUrl) {
        return configuredUrl;
    }

    return '/api/v1';
};

const api = axios.create({
    baseURL: resolveApiBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const fetchScreenerResults = async () => {
    try {
        const response = await api.get('/screen');
        return response.data;
    } catch (error) {
        console.error("Error fetching screener results:", error);
        throw error;
    }
};

export const fetchAnalysis = async (ticker) => {
    try {
        const response = await api.post('/analyze', { ticker });
        return response.data;
    } catch (error) {
        console.error("Error fetching analysis:", error);
        throw error;
    }
};

export const loginWithGoogle = async (idToken) => {
    try {
        const response = await api.post('/auth/google', { id_token: idToken });
        return response.data;
    } catch (error) {
        console.error("Error logging in with Google:", error);
        throw error;
    }
};

export const getPortfolio = async () => {
    try {
        const response = await api.get('/portfolio');
        return response.data;
    } catch (error) {
        console.error("Error fetching portfolio:", error);
        throw error;
    }
};

export const addTrade = async (trade) => {
    try {
        const response = await api.post('/portfolio/add', trade);
        return response.data;
    } catch (error) {
        console.error("Error adding trade:", error);
        throw error;
    }
};

export const deleteTrade = async (ticker) => {
    try {
        const response = await api.delete(`/portfolio/delete/${ticker}`);
        return response.data;
    } catch (error) {
        console.error("Error deleting trade:", error);
        throw error;
    }
};

export const searchStocks = async (query) => {
    try {
        const response = await api.get(`/search?q=${query}`);
        return response.data;
    } catch (error) {
        console.error("Error searching stocks:", error);
        return [];
    }
};

export const fetchPortfolioHistory = async (period = '1y') => {
    try {
        const response = await api.get(`/portfolio/history?period=${period}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching portfolio history:", error);
        throw error;
    }
};

export const fetchDiscoveryScan = async (thresholds = null) => {
    try {
        const response = await api.post('/discovery/scan', { thresholds });
        return response.data;
    } catch (error) {
        console.error("Error fetching discovery scan:", error);
        throw error;
    }
};

export const triggerAsyncDiscoveryScan = async (region = 'IN') => {
    try {
        const response = await api.post('/discovery/scan/async', { region });
        return response.data;
    } catch (error) {
        console.error("Error triggering async discovery scan:", error);
        throw error;
    }
};

export const getAsyncDiscoveryStatus = async (jobId) => {
    try {
        const response = await api.get(`/discovery/status/${jobId}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching async discovery status:", error);
        throw error;
    }
};

export const getAsyncDiscoveryResults = async (jobId) => {
    try {
        const response = await api.get(`/discovery/results/${jobId}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching async discovery results:", error);
        throw error;
    }
};

export const getHDFCLoginUrl = async (redirectUri = null) => {
    try {
        const suffix = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
        const response = await api.get(`/auth/hdfc/login${suffix}`);
        return response.data.login_url;
    } catch (error) {
        console.error("Error getting HDFC login URL:", error);
        return null;
    }
};

export const handleHDFCCallback = async (
    callbackToken,
    tokenParam = 'request_token',
    appRedirect = null
) => {
    try {
        const params = new URLSearchParams();
        params.append(tokenParam, callbackToken);
        if (appRedirect) {
            params.append('app_redirect', appRedirect);
        }
        const response = await api.get(`/auth/callback?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error("Error handling HDFC callback:", error);
        throw error;
    }
};

export const syncHDFCPortfolio = async () => {
    try {
        const response = await api.post('/portfolio/sync/hdfc');
        return response.data;
    } catch (error) {
        console.error("Error syncing HDFC portfolio:", error);
        throw error;
    }
};

export default api;
