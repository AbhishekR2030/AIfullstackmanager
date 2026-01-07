import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api/v1',
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

export const getPortfolio = async () => {
    try {
        const response = await api.get('/portfolio');
        return response.data;
    } catch (error) {
        console.error("Error fetching portfolio:", error);
        throw error;
    }
}

export const addTrade = async (trade) => {
    try {
        const response = await api.post('/portfolio/add', trade);
        return response.data;
    } catch (error) {
        console.error("Error adding trade:", error);
        throw error;
    }
}

export const deleteTrade = async (ticker) => {
    try {
        const response = await api.delete(`/portfolio/delete/${ticker}`);
        return response.data;
    } catch (error) {
        console.error("Error deleting trade:", error);
        throw error;
    }
}

export const searchStocks = async (query) => {
    try {
        const response = await api.get(`/search?q=${query}`);
        return response.data;
    } catch (error) {
        console.error("Error searching stocks:", error);
        return [];
    }
}

export const fetchPortfolioHistory = async (period = '1y') => {
    try {
        const response = await api.get(`/portfolio/history?period=${period}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching portfolio history:", error);
        throw error;
    }
}

export default api;
