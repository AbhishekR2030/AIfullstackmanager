import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Telescope, PieChart, Menu } from 'lucide-react';
import './Layout.css';

const Layout = ({ children }) => {
    const location = useLocation();

    const isActive = (path) => location.pathname === path ? 'active' : '';

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
            </nav>

            <main className="main-content">
                <div className="container">
                    {children}
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
            </nav>
        </div>
    );
};

export default Layout;
