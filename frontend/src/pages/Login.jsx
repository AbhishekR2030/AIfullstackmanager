import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Apple, ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import api, { loginWithApple, loginWithGoogle } from '../services/api';
import { persistAuth, restoreAuth } from '../services/authStorage';
import { hasHdfcCallbackParams, persistPendingHdfcCallback } from '../services/hdfcCallbackStorage';
import { hasZerodhaCallbackParams, persistPendingZerodhaCallback } from '../services/zerodhaCallbackStorage';
import './Login.css';

const MOBILE_HDFC_REDIRECT = 'com.alphaseeker.india://auth/callback';
const APPLE_CLIENT_ID = (import.meta.env.VITE_APPLE_CLIENT_ID || 'com.alphaseeker.india').trim();
const APPLE_REDIRECT_URI = (
    import.meta.env.VITE_APPLE_REDIRECT_URI
    || 'https://alphaseeker-backend-346290058828.us-central1.run.app/api/v1/auth/apple/return'
).trim();
const SHOW_APPLE_LOGIN = false;
const AppPlugin = registerPlugin('App');

const googleGlyph = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.33-.17-1.95H12v3.69h5.39a4.62 4.62 0 0 1-2 3.03v2.51h3.22c1.88-1.73 2.99-4.28 2.99-7.28Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.44l-3.22-2.51c-.89.6-2.02.95-3.4.95-2.61 0-4.83-1.76-5.62-4.13H3.06v2.59A9.99 9.99 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.38 13.87A5.99 5.99 0 0 1 6.06 12c0-.65.11-1.28.32-1.87V7.54H3.06A9.99 9.99 0 0 0 2 12c0 1.6.38 3.11 1.06 4.46l3.32-2.59Z" />
        <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.51 3.83 1.49l2.87-2.87C16.96 2.98 14.7 2 12 2A9.99 9.99 0 0 0 3.06 7.54l3.32 2.59C7.17 7.74 9.39 5.98 12 5.98Z" />
    </svg>
);

const extractErrorMessage = (err, fallback) => {
    if (!err?.response) {
        return err?.message?.trim() || "Unable to reach server. Check backend URL/network.";
    }

    const { status, data } = err.response;

    if (typeof data === 'string' && data.trim()) {
        return `Request failed (${status}): ${data}`;
    }

    if (typeof data?.detail === 'string' && data.detail.trim()) {
        return data.detail;
    }

    if (typeof data?.detail?.error?.message === 'string' && data.detail.error.message.trim()) {
        return data.detail.error.message;
    }

    if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
        return data.error.message;
    }

    if (Array.isArray(data?.detail) && data.detail.length > 0) {
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

const randomToken = (size = 16) => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [providerLoading, setProviderLoading] = useState('');
    const navigate = useNavigate();
    const isNative = Capacitor.isNativePlatform();

    useEffect(() => {
        document.body.classList.add('login-route');
        return () => {
            document.body.classList.remove('login-route');
        };
    }, []);

    useEffect(() => {
        if (!isNative) {
            return;
        }
        GoogleAuth.initialize().catch((initError) => {
            console.warn('GoogleAuth init failed', initError);
        });
    }, [isNative]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (![...params.keys()].length) {
            return;
        }

        if (!hasHdfcCallbackParams(params)) {
            return;
        }

        persistPendingHdfcCallback(params);

        const deepLink = new URL(MOBILE_HDFC_REDIRECT);
        params.forEach((value, key) => {
            deepLink.searchParams.set(key, value);
        });
        window.location.replace(deepLink.toString());
    }, []);

    useEffect(() => {
        if (!isNative) {
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
                    api.defaults.headers.common.Authorization = `Bearer ${token}`;
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
    }, [isNative, navigate]);

    useEffect(() => {
        const bootstrapAuth = async () => {
            const { token } = await restoreAuth();
            if (token) {
                api.defaults.headers.common.Authorization = `Bearer ${token}`;
                navigate('/', { replace: true });
            }
        };
        bootstrapAuth();
    }, [navigate]);

    const handleGoogleLogin = async () => {
        setError('');
        setProviderLoading('google');
        try {
            if (!isNative) {
                throw new Error('Google sign-in is available from the iOS app build.');
            }

            const googleUser = await GoogleAuth.signIn();
            const idToken = googleUser?.authentication?.idToken;
            if (!idToken) {
                throw new Error('Missing Google ID token');
            }

            const response = await loginWithGoogle(idToken);
            const normalizedEmail = (googleUser.email || response?.user?.email || '').trim().toLowerCase();
            await persistAuth(response.access_token, normalizedEmail);
            api.defaults.headers.common.Authorization = `Bearer ${response.access_token}`;
            navigate('/');
        } catch (loginError) {
            console.error('Google Sign-In Error:', loginError);
            setError(extractErrorMessage(loginError, 'Google Sign-In failed'));
        } finally {
            setProviderLoading('');
        }
    };

    const handleAppleLogin = async () => {
        setError('');
        setProviderLoading('apple');
        try {
            if (!isNative) {
                throw new Error('Apple sign-in is available from the iOS app build.');
            }

            const response = await SignInWithApple.authorize({
                clientId: APPLE_CLIENT_ID,
                redirectURI: APPLE_REDIRECT_URI,
                scopes: 'email name',
                state: randomToken(10),
                nonce: randomToken(16),
            });

            const appleResponse = response?.response;
            if (!appleResponse?.identityToken) {
                throw new Error('Apple did not return an identity token.');
            }

            const authResponse = await loginWithApple({
                identity_token: appleResponse.identityToken,
                authorization_code: appleResponse.authorizationCode,
                email: appleResponse.email,
                given_name: appleResponse.givenName,
                family_name: appleResponse.familyName,
                user: appleResponse.user,
            });

            const normalizedEmail = (authResponse?.user?.email || appleResponse.email || '').trim().toLowerCase();
            await persistAuth(authResponse.access_token, normalizedEmail);
            api.defaults.headers.common.Authorization = `Bearer ${authResponse.access_token}`;
            navigate('/');
        } catch (loginError) {
            console.error('Apple Sign-In Error:', loginError);
            setError(extractErrorMessage(loginError, 'Apple Sign-In failed'));
        } finally {
            setProviderLoading('');
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const normalizedEmail = email.trim().toLowerCase();
            if (!normalizedEmail) {
                setError('Email is required');
                return;
            }

            if (isLogin) {
                const response = await api.post('/auth/login', {
                    email: normalizedEmail,
                    password,
                });

                await persistAuth(response.data.access_token, normalizedEmail);
                api.defaults.headers.common.Authorization = `Bearer ${response.data.access_token}`;
                navigate('/');
            } else {
                const response = await api.post('/auth/signup', { email: normalizedEmail, password });
                await persistAuth(response.data.access_token, normalizedEmail);
                api.defaults.headers.common.Authorization = `Bearer ${response.data.access_token}`;
                navigate('/');
            }
        } catch (authError) {
            console.error('Auth Error', authError);
            setError(extractErrorMessage(authError, 'Authentication failed'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <div className="login-surface">
                <section className="login-hero-panel">
                    <h1>AlphaSeeker</h1>
                    <div className="hero-positioning">
                        <p className="hero-statement">Invest like a hedge fund.</p>
                        <p>
                            Sync your portfolio and discover institutional strategies that reveal what to buy,
                            sell, and rebalance. All in your native Quant terminal.
                        </p>
                    </div>
                </section>

                <section className="login-form-panel">
                    <div className="auth-tabs">
                        <button
                            type="button"
                            className={`tab ${isLogin ? 'active' : ''}`}
                            onClick={() => setIsLogin(true)}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            className={`tab ${!isLogin ? 'active' : ''}`}
                            onClick={() => setIsLogin(false)}
                        >
                            Create Account
                        </button>
                    </div>

                    <div className="login-copy">
                        <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
                        <p>{isLogin ? 'Resume your portfolio workflow and broker sync.' : 'Start with email, then unlock broker and strategy access.'}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="auth-form">
                        {error && <div className="error-banner">{error}</div>}

                        <div className="form-group">
                            <label>Email Address</label>
                            <div className="input-shell">
                                <Mail size={16} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    placeholder="name@example.com"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Password</label>
                            <div className="input-shell">
                                <LockKeyhole size={16} />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn-auth" disabled={isLoading}>
                            <span>{isLoading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}</span>
                            {!isLoading ? <ArrowRight size={16} /> : null}
                        </button>
                    </form>

                    <div className="divider">
                        <span>or continue with</span>
                    </div>

                    <div className={`social-login ${SHOW_APPLE_LOGIN ? '' : 'single-provider'}`}>
                        <button
                            type="button"
                            className="btn-social"
                            onClick={handleGoogleLogin}
                            disabled={providerLoading === 'google'}
                        >
                            <span className="provider-glyph google">{googleGlyph}</span>
                            <span>{providerLoading === 'google' ? 'Connecting...' : 'Google'}</span>
                        </button>
                        {SHOW_APPLE_LOGIN ? (
                            <button
                                type="button"
                                className="btn-social apple"
                                onClick={handleAppleLogin}
                                disabled={providerLoading === 'apple'}
                            >
                                <span className="provider-glyph apple">
                                    <Apple size={18} />
                                </span>
                                <span>{providerLoading === 'apple' ? 'Connecting...' : 'Apple'}</span>
                            </button>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Login;
