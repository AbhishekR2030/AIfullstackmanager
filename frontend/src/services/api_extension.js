export const deleteTrade = async (ticker) => {
    try {
        const response = await api.delete(`/portfolio/delete/${ticker}`);
        return response.data;
    } catch (error) {
        console.error("Error deleting trade:", error);
        throw error;
    }
}
