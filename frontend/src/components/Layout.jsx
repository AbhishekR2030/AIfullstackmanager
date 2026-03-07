import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { handleHDFCCallback, syncHDFCPortfolio, syncZerodhaPortfolio } from '../services/api';
import { clearAuth, restoreAuth } from '../services/authStorage';
import {
    consumePendingHdfcCallback,
    hasHdfcCallbackParams,
    persistPendingHdfcCallback,
} from '../services/hdfcCallbackStorage';
import {
    consumePendingZerodhaCallback,
    hasZerodhaCallbackParams,
    persistPendingZerodhaCallback,
} from '../services/zerodhaCallbackStorage';
import { LayoutDashboard, Telescope, PieChart, UserRound } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor, registerPlugin } from '@capacitor/core';
import ProfilePanel from './ProfilePanel';
import './Layout.css';

const AppPlugin = registerPlugin('App');
const PROFILE_OPEN_EVENT = 'alphaseeker:open-profile';
const PROFILE_UPDATED_EVENT = 'alphaseeker:profile-updated';

const deriveInitials = (email = '', firstName = '', lastName = '') => {
    if (firstName && lastName) {
        return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    if (firstName) {
        return firstName.slice(0, 2).toUpperCase();
    }
    const localPart = (email || '').split('@')[0] || 'as';
    const tokens = localPart.split(/[._-]+/).filter(Boolean);
    if (tokens.length >= 2) {
        return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
    }
    return localPart.slice(0, 2).toUpperCase() || 'AS';
};

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [profileOpen, setProfileOpen] = useState(false);
    const [profileInitials, setProfileInitials] = useState('AS');

    const handleNavClick = async () => {
        try {
            await Haptics.impact({ style: ImpactStyle.Light });
        } catch {
            // Haptics plugin not available on some web environments.
        }
    };

    useEffect(() => {
        const hydrateInitials = async () => {
            const auth = await restoreAuth();
            setProfileInitials(deriveInitials(auth?.email || '', auth?.first_name || '', auth?.last_name || ''));
        };
        hydrateInitials();
    }, []);

    useEffect(() => {
        const openProfile = () => setProfileOpen(true);
        const updateProfile = (event) => {
            const detail = event?.detail || {};
            setProfileInitials(deriveInitials(detail?.email || '', detail?.first_name || '', detail?.last_name || ''));
        };
        window.addEventListener(PROFILE_OPEN_EVENT, openProfile);
        window.addEventListener(PROFILE_UPDATED_EVENT, updateProfile);
        return () => {
            window.removeEventListener(PROFILE_OPEN_EVENT, openProfile);
            window.removeEventListener(PROFILE_UPDATED_EVENT, updateProfile);
        };
    }, []);

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

        const handleZerodhaResult = async (params, clearWebQuery = false) => {
            const broker = (params.get('broker') || '').trim().toLowerCase();
            const status = (params.get('status') || '').trim().toLowerCase();
            const error = params.get('error');

            if (broker !== 'zerodha' || !status) {
                return;
            }

            try {
                if (status !== 'success') {
                    throw new Error(error || 'Zerodha authorization failed');
                }

                await syncZerodhaPortfolio();
                alert("Zerodha Login Successful! Portfolio Synced.");
            } catch (callbackError) {
                console.error("Zerodha Callback Error:", callbackError);
                alert(error || callbackError?.message || "Failed to complete Zerodha Login.");
            } finally {
                if (clearWebQuery) {
                    navigate(location.pathname, { replace: true });
                }
            }
        };

        // Web fallback flow: callback params in current URL.
        const currentParams = new URLSearchParams(location.search);
        handleHDFCResult(currentParams, true);
        handleZerodhaResult(currentParams, true);

        // Cold-start fallback: process callback captured while login route was active.
        const pendingParams = consumePendingHdfcCallback();
        if (pendingParams && hasHdfcCallbackParams(pendingParams)) {
            handleHDFCResult(pendingParams, false);
        }
        const pendingZerodhaParams = consumePendingZerodhaCallback();
        if (pendingZerodhaParams && hasZerodhaCallbackParams(pendingZerodhaParams)) {
            handleZerodhaResult(pendingZerodhaParams, false);
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
                            if (hasZerodhaCallbackParams(deepLinkParams)) {
                                persistPendingZerodhaCallback(deepLinkParams);
                            }
                            handleHDFCResult(deepLinkParams, false);
                            handleZerodhaResult(deepLinkParams, false);
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
            setProfileOpen(false);
            navigate('/login');
        }
    };

    return (
        <div className="app-layout">
            <ProfilePanel isOpen={profileOpen} onClose={() => setProfileOpen(false)} onLogout={handleLogout} />

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
                <button
                    type="button"
                    className="nav-profile-trigger"
                    onClick={() => setProfileOpen(true)}
                    aria-label="Open profile"
                >
                    <UserRound size={18} />
                    <span>{profileInitials}</span>
                </button>
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
                <button type="button" className="mobile-nav-item profile-nav-item" onClick={() => setProfileOpen(true)}>
                    <UserRound size={20} />
                    <span>Profile</span>
                </button>
            </nav>
        </div>
    );
};

export default Layout;
