import React from 'react';

const Dashboard = () => {
    return (
        <div>
            <h1>Dashboard</h1>
            <p className="text-muted">Portfolio overview coming soon.</p>

            <div style={{ marginTop: '2rem' }}>
                <div className="card">
                    <h3>Total Value</h3>
                    <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>₹12,45,000</p>
                    <p className="text-success">+4.5% This Month</p>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
