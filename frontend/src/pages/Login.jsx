import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Login.css';

const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (isLogin) {
                // Login Flow (JSON)
                const response = await api.post('/auth/login', {
                    email: email,
                    password: password
                });

                localStorage.setItem('token', response.data.access_token);
                localStorage.setItem('userEmail', email);
                api.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
                navigate('/');
            } else {
                // Signup Flow
                const response = await api.post('/auth/signup', { email, password });
                localStorage.setItem('token', response.data.access_token);
                localStorage.setItem('userEmail', email);
                api.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
                navigate('/');
            }
        } catch (err) {
            console.error("Auth Error", err);
            setError(err.response?.data?.detail || "Authentication failed");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="logo-area">
                    <h1>AlphaSeeker</h1>
                    <p>India's Premium Quant Terminal</p>
                </div>

                <div className="auth-tabs">
                    <button
                        className={`tab ${isLogin ? 'active' : ''}`}
                        onClick={() => setIsLogin(true)}
                    >
                        Sign In
                    </button>
                    <button
                        className={`tab ${!isLogin ? 'active' : ''}`}
                        onClick={() => setIsLogin(false)}
                    >
                        Create Account
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    {error && <div className="error-banner">{error}</div>}

                    <div className="form-group">
                        <label>Email Address</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                        />
                    </div>

                    <button type="submit" className="btn-auth" disabled={isLoading}>
                        {isLoading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <div className="divider">
                    <span>OR CONTINUE WITH</span>
                </div>

                <div className="social-login">
                    <button className="btn-social" disabled>
                        <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" width="20" />
                        Google
                    </button>
                    <button className="btn-social" disabled>
                        <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405 1.02 0 2.04.135 3 .405 2.28-1.56 3.285-1.23 3.285-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.285 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        GitHub
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Login;
