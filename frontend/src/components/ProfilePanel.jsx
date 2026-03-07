import React, { useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    CreditCard,
    LogOut,
    Moon,
    ShieldCheck,
    Sparkles,
    Sun,
    UserRound,
    X,
} from 'lucide-react';
import {
    createRazorpayOrder,
    fetchAccountProfile,
    updateAccountProfile,
    verifyRazorpayPayment,
} from '../services/api';
import { applyTheme, getStoredTheme, THEME_UPDATED_EVENT } from '../services/theme';
import './ProfilePanel.css';

const PROFILE_UPDATED_EVENT = 'alphaseeker:profile-updated';

const fallbackState = {
    profile: {
        email: '',
        plan: 'free',
        billing_plan: null,
        plan_expires_at: null,
        is_builder: false,
        initials: 'AS',
        first_name: '',
        middle_name: '',
        last_name: '',
        profession: '',
    },
    subscription: {
        status: 'inactive',
        plan: 'free',
        billing_plan: null,
        source: 'none',
        renews_at: null,
        entitlements: {},
        can_subscribe: false,
        payment_provider: null,
    },
    pricing: [],
};

const formatDateTime = (value) => {
    if (!value) {
        return 'Not scheduled';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(parsed);
};

const entitlementPairs = (entitlements) => [
    ['Strategy access', entitlements?.strategy_access === 'all' ? 'All strategies' : 'Core only'],
    ['Scans per day', entitlements?.scans_per_day ?? 'Unlimited'],
    ['AI thesis', entitlements?.ai_thesis_per_day ?? 'Unlimited'],
    ['Broker sync', entitlements?.broker_sync ? 'Enabled' : 'Not included'],
    ['Rebalancing', entitlements?.rebalancing ? 'Enabled' : 'Not included'],
    ['History ranges', Array.isArray(entitlements?.portfolio_history_ranges) ? entitlements.portfolio_history_ranges.join(', ').toUpperCase() : '1M'],
];

const initialProfileForm = {
    first_name: '',
    middle_name: '',
    last_name: '',
    profession: '',
};

const extractErrorMessage = (error, fallback) => {
    if (!error?.response) {
        return error?.message || fallback;
    }
    const data = error.response.data;
    if (typeof data?.detail?.message === 'string' && data.detail.message.trim()) {
        return data.detail.message;
    }
    if (typeof data?.message === 'string' && data.message.trim()) {
        return data.message;
    }
    if (typeof data?.detail === 'string' && data.detail.trim()) {
        return data.detail;
    }
    return fallback;
};

const loadRazorpayScript = async () => {
    if (window.Razorpay) {
        return true;
    }

    return new Promise((resolve) => {
        const existing = document.querySelector('script[data-razorpay-sdk="true"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(true), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.dataset.razorpaySdk = 'true';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

const AccordionCard = ({
    title,
    kicker,
    icon,
    isOpen,
    onToggle,
    children,
    rightContent = null,
}) => (
    <section className={`profile-card accordion-card ${isOpen ? 'open' : ''}`}>
        <button type="button" className="accordion-trigger" onClick={onToggle}>
            <div className="profile-section-head">
                <div>
                    <p className="profile-section-kicker">{kicker}</p>
                    <h3>{title}</h3>
                </div>
                <div className="accordion-head-actions">
                    {rightContent}
                    {icon}
                    <ChevronDown size={18} className={`accordion-chevron ${isOpen ? 'open' : ''}`} />
                </div>
            </div>
        </button>
        {isOpen ? <div className="accordion-body">{children}</div> : null}
    </section>
);

const ProfilePanel = ({ isOpen, onClose, onLogout }) => {
    const [theme, setTheme] = useState(getStoredTheme());
    const [profileData, setProfileData] = useState(fallbackState);
    const [profileForm, setProfileForm] = useState(initialProfileForm);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const [checkoutLoading, setCheckoutLoading] = useState('');
    const [profileMessage, setProfileMessage] = useState('');
    const [sections, setSections] = useState({
        details: true,
        settings: false,
        subscription: true,
        pricing: false,
    });

    const refreshProfile = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const payload = await fetchAccountProfile();
            const nextState = {
                profile: payload?.profile || fallbackState.profile,
                subscription: payload?.subscription || fallbackState.subscription,
                pricing: Array.isArray(payload?.pricing) ? payload.pricing : [],
            };
            setProfileData(nextState);
            setProfileForm({
                first_name: nextState.profile?.first_name || '',
                middle_name: nextState.profile?.middle_name || '',
                last_name: nextState.profile?.last_name || '',
                profession: nextState.profile?.profession || '',
            });
            window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: nextState.profile }));
        } catch (error) {
            console.error('Failed to load account profile', error);
            setLoadError('Unable to load latest profile details.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const syncTheme = (event) => {
            setTheme(event?.detail?.theme || getStoredTheme());
        };
        window.addEventListener(THEME_UPDATED_EVENT, syncTheme);
        return () => window.removeEventListener(THEME_UPDATED_EVENT, syncTheme);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setLoadError('');

        fetchAccountProfile()
            .then((payload) => {
                if (cancelled) {
                    return;
                }
                const nextState = {
                    profile: payload?.profile || fallbackState.profile,
                    subscription: payload?.subscription || fallbackState.subscription,
                    pricing: Array.isArray(payload?.pricing) ? payload.pricing : [],
                };
                setProfileData(nextState);
                setProfileForm({
                    first_name: nextState.profile?.first_name || '',
                    middle_name: nextState.profile?.middle_name || '',
                    last_name: nextState.profile?.last_name || '',
                    profession: nextState.profile?.profession || '',
                });
                window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: nextState.profile }));
            })
            .catch((error) => {
                console.error('Failed to load account profile', error);
                if (!cancelled) {
                    setLoadError('Unable to load latest profile details.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    const entitlements = useMemo(
        () => entitlementPairs(profileData.subscription?.entitlements || {}),
        [profileData.subscription]
    );

    const activePricingId = useMemo(() => {
        const activePlan = profileData.subscription?.plan || 'free';
        const activeBillingPlan = profileData.subscription?.billing_plan || null;
        if (activePlan !== 'pro') {
            return 'free';
        }
        return activeBillingPlan === 'yearly' ? 'pro_yearly' : 'pro_monthly';
    }, [profileData.subscription]);

    const toggleSection = (key) => {
        setSections((current) => ({ ...current, [key]: !current[key] }));
    };

    const handleProfileChange = (field, value) => {
        setProfileForm((current) => ({ ...current, [field]: value }));
    };

    const handleProfileSave = async () => {
        setSavingProfile(true);
        setProfileMessage('');
        setLoadError('');
        try {
            const response = await updateAccountProfile(profileForm);
            const nextProfile = response?.profile || {};
            setProfileData((current) => ({
                ...current,
                profile: {
                    ...current.profile,
                    ...nextProfile,
                },
            }));
            window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: nextProfile }));
            setProfileMessage('Profile details updated.');
        } catch (error) {
            setLoadError(extractErrorMessage(error, 'Unable to save profile details.'));
        } finally {
            setSavingProfile(false);
        }
    };

    const handleCheckout = async (plan) => {
        setCheckoutLoading(plan);
        setProfileMessage('');
        setLoadError('');
        try {
            const scriptLoaded = await loadRazorpayScript();
            if (!scriptLoaded || !window.Razorpay) {
                throw new Error('Razorpay checkout could not be loaded.');
            }

            const order = await createRazorpayOrder(plan);
            const razorpay = new window.Razorpay({
                key: order.key_id,
                amount: order.amount,
                currency: order.currency,
                name: order.name,
                description: order.description,
                order_id: order.order_id,
                prefill: order.prefill,
                theme: order.theme,
                modal: {
                    ondismiss: () => setCheckoutLoading(''),
                },
                handler: async (response) => {
                    try {
                        await verifyRazorpayPayment({
                            plan,
                            order_id: response.razorpay_order_id,
                            payment_id: response.razorpay_payment_id,
                            signature: response.razorpay_signature,
                        });
                        setProfileMessage('Subscription activated successfully.');
                        await refreshProfile();
                    } catch (verifyError) {
                        setLoadError(extractErrorMessage(verifyError, 'Payment succeeded but verification failed.'));
                    } finally {
                        setCheckoutLoading('');
                    }
                },
            });

            razorpay.on('payment.failed', (response) => {
                setLoadError(response?.error?.description || 'Payment failed.');
                setCheckoutLoading('');
            });

            razorpay.open();
        } catch (error) {
            setLoadError(extractErrorMessage(error, 'Unable to start Razorpay checkout.'));
            setCheckoutLoading('');
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="profile-panel-overlay" onClick={onClose}>
            <aside className="profile-panel" onClick={(event) => event.stopPropagation()}>
                <div className="profile-panel-head">
                    <div>
                        <p className="profile-panel-kicker">Account</p>
                        <h2>Profile & Settings</h2>
                    </div>
                    <button type="button" className="profile-close-btn" onClick={onClose} aria-label="Close profile panel">
                        <X size={18} />
                    </button>
                </div>

                <section className="profile-card profile-summary-card">
                    <div className="profile-avatar">{profileData.profile?.initials || 'AS'}</div>
                    <div className="profile-summary-copy">
                        <strong>{profileData.profile?.email || 'Signed-in user'}</strong>
                        <span className={`plan-badge ${profileData.profile?.plan === 'pro' ? 'pro' : 'free'}`}>
                            {profileData.profile?.is_builder ? 'Builder Pro Access' : `${(profileData.profile?.plan || 'free').toUpperCase()} plan`}
                        </span>
                        <p>
                            {profileData.subscription?.status === 'active'
                                ? `Subscription active${profileData.subscription?.billing_plan ? ` · ${profileData.subscription.billing_plan}` : ''}`
                                : 'No paid subscription active'}
                        </p>
                    </div>
                </section>

                <AccordionCard
                    title="Profile"
                    kicker="Personal details"
                    icon={<UserRound size={18} />}
                    isOpen={sections.details}
                    onToggle={() => toggleSection('details')}
                >
                    <div className="profile-form-grid">
                        <label className="profile-input-group">
                            <span>First Name</span>
                            <input value={profileForm.first_name} onChange={(event) => handleProfileChange('first_name', event.target.value)} placeholder="Abhishek" />
                        </label>
                        <label className="profile-input-group">
                            <span>Middle Name</span>
                            <input value={profileForm.middle_name} onChange={(event) => handleProfileChange('middle_name', event.target.value)} placeholder="Optional" />
                        </label>
                        <label className="profile-input-group">
                            <span>Last Name</span>
                            <input value={profileForm.last_name} onChange={(event) => handleProfileChange('last_name', event.target.value)} placeholder="Reddy" />
                        </label>
                        <label className="profile-input-group profile-input-span">
                            <span>Profession</span>
                            <input value={profileForm.profession} onChange={(event) => handleProfileChange('profession', event.target.value)} placeholder="Investor, engineer, founder…" />
                        </label>
                    </div>
                    <div className="profile-inline-actions">
                        <button type="button" className="profile-primary-btn" onClick={handleProfileSave} disabled={savingProfile}>
                            <span>{savingProfile ? 'Saving…' : 'Save details'}</span>
                        </button>
                    </div>
                </AccordionCard>

                <AccordionCard
                    title="Settings"
                    kicker="Appearance"
                    icon={theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                    isOpen={sections.settings}
                    onToggle={() => toggleSection('settings')}
                >
                    <div className="theme-toggle-group">
                        <button
                            type="button"
                            className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                            onClick={() => setTheme(applyTheme('light'))}
                        >
                            <Sun size={15} />
                            <span>Light</span>
                        </button>
                        <button
                            type="button"
                            className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                            onClick={() => setTheme(applyTheme('dark'))}
                        >
                            <Moon size={15} />
                            <span>Dark</span>
                        </button>
                    </div>
                </AccordionCard>

                <AccordionCard
                    title="Subscription"
                    kicker="Active access"
                    icon={<CreditCard size={18} />}
                    isOpen={sections.subscription}
                    onToggle={() => toggleSection('subscription')}
                    rightContent={profileData.subscription?.status === 'active' ? <span className="inline-status success">Active</span> : <span className="inline-status">Free</span>}
                >
                    <div className="subscription-meta">
                        <div>
                            <span>Status</span>
                            <strong>{profileData.subscription?.status === 'active' ? 'Active' : 'Inactive'}</strong>
                        </div>
                        <div>
                            <span>Plan cycle</span>
                            <strong>{profileData.subscription?.billing_plan || (profileData.profile?.is_builder ? 'Builder override' : 'Free')}</strong>
                        </div>
                        <div>
                            <span>Renews / expires</span>
                            <strong>{formatDateTime(profileData.subscription?.renews_at)}</strong>
                        </div>
                    </div>
                    <div className="entitlements-grid">
                        {entitlements.map(([label, value]) => (
                            <div key={label} className="entitlement-item">
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>
                    {profileData.subscription?.can_subscribe ? (
                        <div className="upgrade-cta">
                            <p>Upgrade from Free to unlock broker sync, custom thresholds, all strategy engines, and full portfolio rebalancing.</p>
                            {profileData.subscription?.payment_provider === 'razorpay' ? (
                                <div className="upgrade-cta-actions">
                                    <button
                                        type="button"
                                        className="profile-primary-btn"
                                        onClick={() => handleCheckout('monthly')}
                                        disabled={checkoutLoading === 'monthly'}
                                    >
                                        {checkoutLoading === 'monthly' ? 'Opening…' : 'Upgrade Monthly'}
                                    </button>
                                    <button
                                        type="button"
                                        className="profile-secondary-btn"
                                        onClick={() => handleCheckout('yearly')}
                                        disabled={checkoutLoading === 'yearly'}
                                    >
                                        {checkoutLoading === 'yearly' ? 'Opening…' : 'Upgrade Yearly'}
                                    </button>
                                </div>
                            ) : (
                                <p>Checkout is ready in the app, but Razorpay keys still need to be configured on the backend before payments can be opened.</p>
                            )}
                        </div>
                    ) : null}
                </AccordionCard>

                <AccordionCard
                    title="Pricing"
                    kicker="Tier details"
                    icon={<ShieldCheck size={18} />}
                    isOpen={sections.pricing}
                    onToggle={() => toggleSection('pricing')}
                >
                    <div className="pricing-cards">
                        {profileData.pricing.map((tier) => (
                            <article
                                key={tier.id}
                                className={`pricing-card ${tier.id === activePricingId ? 'active' : ''}`}
                            >
                                <div className="pricing-card-head">
                                    <div>
                                        <h4>{tier.name}</h4>
                                        <p>{tier.summary}</p>
                                    </div>
                                    <span className="pricing-price">{tier.price_label}</span>
                                </div>
                                <ul>
                                    {(tier.features || []).map((feature) => (
                                        <li key={feature}>
                                            <Sparkles size={13} />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                                {profileData.subscription?.can_subscribe && profileData.subscription?.payment_provider === 'razorpay' && tier.checkout_plan ? (
                                    <button
                                        type="button"
                                        className="pricing-subscribe-btn"
                                        onClick={() => handleCheckout(tier.checkout_plan)}
                                        disabled={checkoutLoading === tier.checkout_plan}
                                    >
                                        {checkoutLoading === tier.checkout_plan ? 'Opening…' : `Choose ${tier.name}`}
                                    </button>
                                ) : null}
                            </article>
                        ))}
                    </div>
                </AccordionCard>

                {loadError ? <p className="profile-error">{loadError}</p> : null}
                {profileMessage ? <p className="profile-success">{profileMessage}</p> : null}
                {loading ? <p className="profile-loading">Refreshing account details…</p> : null}

                <div className="profile-actions">
                    <button type="button" className="profile-logout-btn" onClick={onLogout}>
                        <LogOut size={16} />
                        <span>Logout</span>
                    </button>
                    <button type="button" className="profile-close-secondary" onClick={onClose}>
                        <UserRound size={16} />
                        <span>Close</span>
                    </button>
                </div>
            </aside>
        </div>
    );
};

export default ProfilePanel;
