import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
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

export default api;
