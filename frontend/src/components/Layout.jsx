import React from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Telescope, PieChart, LogOut } from 'lucide-react';
import './Layout.css';

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path) => location.pathname === path ? 'active' : '';

    const handleLogout = () => {
        if (window.confirm("Are you sure you want to sign out?")) {
            localStorage.removeItem('token');
            localStorage.removeItem('userEmail');
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
                    <Link to="/" className={`nav-item ${isActive('/')}`}>
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </Link>
                    <Link to="/discovery" className={`nav-item ${isActive('/discovery')}`}>
                        <Telescope size={20} />
                        <span>Discovery</span>
                    </Link>
                    <Link to="/portfolio" className={`nav-item ${isActive('/portfolio')}`}>
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
                <Link to="/" className={`mobile-nav-item ${isActive('/')}`}>
                    <LayoutDashboard size={24} />
                </Link>
                <Link to="/discovery" className={`mobile-nav-item ${isActive('/discovery')}`}>
                    <Telescope size={24} />
                </Link>
                <Link to="/portfolio" className={`mobile-nav-item ${isActive('/portfolio')}`}>
                    <PieChart size={24} />
                </Link>
                <button className="mobile-nav-item btn-logout-mobile" onClick={handleLogout}>
                    <LogOut size={24} />
                </button>
            </nav>
        </div>
    );
};

export default Layout;
