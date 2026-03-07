import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { loginWithGoogle } from '../services/api';
import { persistAuth, restoreAuth } from '../services/authStorage';
import { hasHdfcCallbackParams, persistPendingHdfcCallback } from '../services/hdfcCallbackStorage';
import { hasZerodhaCallbackParams, persistPendingZerodhaCallback } from '../services/zerodhaCallbackStorage';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor, registerPlugin } from '@capacitor/core';
import './Login.css';

const MOBILE_HDFC_REDIRECT = 'com.alphaseeker.india://auth/callback';
const AppPlugin = registerPlugin('App');

const extractErrorMessage = (err, fallback) => {
    if (!err?.response) {
        return "Unable to reach server. Check backend URL/network.";
    }

    const { status, data } = err.response;

    if (typeof data === 'string' && data.trim()) {
        return `Request failed (${status}): ${data}`;
    }

    if (typeof data?.detail === 'string' && data.detail.trim()) {
        return data.detail;
    }

    if (Array.isArray(data?.detail) && data.detail.length > 0) {
        // FastAPI validation errors often return detail as an array
        return data.detail.map((item) => item?.msg || JSON.stringify(item)).join(', ');
    }

    if (typeof data?.message === 'string' && data.message.trim()) {
        return data.message;
    }

    if (typeof data?.error === 'string' && data.error.trim()) {
        return data.error;
    }

    return `${fallback} (${status})`;
};

const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    // Initialize Google Auth
    React.useEffect(() => {
        GoogleAuth.initialize();
    }, []);

    // If HDFC redirected to web login page with callback params,
    // bounce back into the native app deep link immediately.
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (![...params.keys()].length) {
            return;
        }

        if (!hasHdfcCallbackParams(params)) {
            return;
        }

        // Keep callback data in case app cold-starts into login route.
        persistPendingHdfcCallback(params);

        const deepLink = new URL(MOBILE_HDFC_REDIRECT);
        params.forEach((value, key) => {
            deepLink.searchParams.set(key, value);
        });
        window.location.replace(deepLink.toString());
    }, []);

    // Capture deep-link callbacks even while login screen is visible.
    React.useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            return undefined;
        }

        let appUrlListener;

        const handleDeepLink = async (url) => {
            try {
                const parsed = new URL(url);
                const params = new URLSearchParams(parsed.search);
                const hasHdfcCallback = hasHdfcCallbackParams(params);
                const hasZerodhaCallback = hasZerodhaCallbackParams(params);

                if (!hasHdfcCallback && !hasZerodhaCallback) {
                    return;
                }

                if (hasHdfcCallback) {
                    persistPendingHdfcCallback(params);
                }
                if (hasZerodhaCallback) {
                    persistPendingZerodhaCallback(params);
                }

                const { token } = await restoreAuth();
                if (token) {
                    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                    navigate('/', { replace: true });
                }
            } catch (err) {
                console.warn('Failed to process deep link on login screen', err);
            }
        };

        const initListener = async () => {
            appUrlListener = await AppPlugin.addListener('appUrlOpen', ({ url }) => {
                handleDeepLink(url);
            });

            try {
                const launchUrl = await AppPlugin.getLaunchUrl();
                if (launchUrl?.url) {
                    handleDeepLink(launchUrl.url);
                }
            } catch (err) {
                console.log('Launch URL unavailable', err);
            }
        };

        initListener();

        return () => {
            if (appUrlListener) {
                appUrlListener.remove();
            }
        };
    }, [navigate]);

    // If auth already exists (including native Preferences restore), skip login screen.
    React.useEffect(() => {
        const bootstrapAuth = async () => {
            const { token } = await restoreAuth();
            if (token) {
                api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                navigate('/', { replace: true });
            }
        };
        bootstrapAuth();
    }, [navigate]);

    const handleGoogleLogin = async () => {
        try {
            const googleUser = await GoogleAuth.signIn();
            const idToken = googleUser?.authentication?.idToken;
            if (!idToken) {
                throw new Error("Missing Google ID token");
            }

            const response = await loginWithGoogle(idToken);
            const normalizedEmail = (googleUser.email || '').trim().toLowerCase();
            await persistAuth(response.access_token, normalizedEmail);
            api.defaults.headers.common['Authorization'] = `Bearer ${response.access_token}`;
            navigate('/');
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            setError(extractErrorMessage(error, "Google Sign-In failed"));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const normalizedEmail = email.trim().toLowerCase();
            if (!normalizedEmail) {
                setError("Email is required");
                return;
            }

            if (isLogin) {
                // Login Flow (JSON)
                const response = await api.post('/auth/login', {
                    email: normalizedEmail,
                    password: password
                });

                await persistAuth(response.data.access_token, normalizedEmail);
                api.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
                navigate('/');
            } else {
                // Signup Flow
                const response = await api.post('/auth/signup', { email: normalizedEmail, password });
                await persistAuth(response.data.access_token, normalizedEmail);
                api.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
                navigate('/');
            }
        } catch (err) {
            console.error("Auth Error", err);
            setError(extractErrorMessage(err, "Authentication failed"));
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
                    <button className="btn-social" onClick={handleGoogleLogin}>
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
