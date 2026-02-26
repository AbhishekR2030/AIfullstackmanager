import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { handleHDFCCallback, syncHDFCPortfolio } from '../services/api';
import { clearAuth } from '../services/authStorage';
import {
    consumePendingHdfcCallback,
    hasHdfcCallbackParams,
    persistPendingHdfcCallback,
} from '../services/hdfcCallbackStorage';
import { LayoutDashboard, Telescope, PieChart, LogOut } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor, registerPlugin } from '@capacitor/core';
import './Layout.css';

const AppPlugin = registerPlugin('App');

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();

    const handleNavClick = async () => {
        try {
            await Haptics.impact({ style: ImpactStyle.Light });
        } catch {
            // Haptics plugin not available on some web environments.
        }
    };

    useEffect(() => {
        const handleHDFCResult = async (params, clearWebQuery = false) => {
            const requestToken = params.get('requestToken') || params.get('request_token');
            const oauthCode = params.get('code');
            const status = params.get('hdfc_status');
            const error = params.get('error');

            if (!requestToken && !oauthCode && !status) {
                return;
            }

            try {
                if (requestToken) {
                    await handleHDFCCallback(requestToken, 'request_token');
                } else if (oauthCode) {
                    await handleHDFCCallback(oauthCode, 'code');
                }

                if (status === 'error') {
                    throw new Error(error || 'HDFC authorization failed');
                }

                await syncHDFCPortfolio();
                alert("HDFC Login Successful! Portfolio Synced.");
            } catch (callbackError) {
                console.error("HDFC Callback Error:", callbackError);
                alert("Failed to complete HDFC Login.");
            } finally {
                if (clearWebQuery) {
                    navigate(location.pathname, { replace: true });
                }
            }
        };

        // Web fallback flow: callback params in current URL.
        const currentParams = new URLSearchParams(location.search);
        handleHDFCResult(currentParams, true);

        // Cold-start fallback: process callback captured while login route was active.
        const pendingParams = consumePendingHdfcCallback();
        if (pendingParams && hasHdfcCallbackParams(pendingParams)) {
            handleHDFCResult(pendingParams, false);
        }

        // Native flow: callback opened via deep link.
        let appUrlListener;
        const registerListener = async () => {
            try {
                if (!Capacitor.isNativePlatform()) {
                    return;
                }

                appUrlListener = await AppPlugin.addListener('appUrlOpen', ({ url }) => {
                    (async () => {
                        try {
                            const { Browser } = await import('@capacitor/browser');
                            await Browser.close();
                        } catch {
                            // Browser may already be closed.
                        }

                        try {
                            const parsedUrl = new URL(url);
                            const deepLinkParams = new URLSearchParams(parsedUrl.search);
                            if (hasHdfcCallbackParams(deepLinkParams)) {
                                persistPendingHdfcCallback(deepLinkParams);
                            }
                            handleHDFCResult(deepLinkParams, false);
                        } catch (parseError) {
                            console.error("Failed to parse deep link URL", parseError);
                        }
                    })();
                });
            } catch (listenerError) {
                console.log("App URL listener unavailable", listenerError);
            }
        };

        registerListener();

        return () => {
            if (appUrlListener) {
                appUrlListener.remove();
            }
        };
    }, [location, navigate]);

    const isActive = (path) => location.pathname === path ? 'active' : '';

    const handleLogout = async () => {
        if (window.confirm("Are you sure you want to sign out?")) {
            await clearAuth();
            navigate('/login');
        }
    };

    return (
        <div className="app-layout">
            <nav className="navbar">
                <div className="nav-brand">
                    <div className="logo-icon">α</div>
                    <span className="logo-text">AlphaSeeker</span>
                </div>

                <div className="nav-links">
                    <Link to="/" className={`nav-item ${isActive('/')}`} onClick={handleNavClick}>
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </Link>
                    <Link to="/discovery" className={`nav-item ${isActive('/discovery')}`} onClick={handleNavClick}>
                        <Telescope size={20} />
                        <span>Discovery</span>
                    </Link>
                    <Link to="/portfolio" className={`nav-item ${isActive('/portfolio')}`} onClick={handleNavClick}>
                        <PieChart size={20} />
                        <span>Portfolio</span>
                    </Link>
                </div>
                <div className="nav-actions">
                    <button className="nav-item btn-logout" onClick={handleLogout} title="Sign Out">
                        <LogOut size={20} />
                        <span className="desktop-only">Sign Out</span>
                    </button>
                </div>
            </nav>

            <main className="main-content">
                <div className="container">
                    {children || <Outlet />}
                </div>
            </main>

            {/* Mobile Bottom Bar */}
            <nav className="mobile-nav">
                <Link to="/" className={`mobile-nav-item ${isActive('/')}`} onClick={handleNavClick}>
                    <LayoutDashboard size={20} />
                    <span>Dashboard</span>
                </Link>
                <Link to="/discovery" className={`mobile-nav-item ${isActive('/discovery')}`} onClick={handleNavClick}>
                    <Telescope size={20} />
                    <span>Discovery</span>
                </Link>
                <Link to="/portfolio" className={`mobile-nav-item ${isActive('/portfolio')}`} onClick={handleNavClick}>
                    <PieChart size={20} />
                    <span>Portfolio</span>
                </Link>
                <button className="mobile-nav-item btn-logout-mobile" type="button" onClick={handleLogout}>
                    <LogOut size={20} />
                    <span>Sign Out</span>
                </button>
            </nav>
        </div>
    );
};

export default Layout;
