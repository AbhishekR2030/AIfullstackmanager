import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Discovery from './pages/Discovery';
import Portfolio from './pages/Portfolio';
import Login from './pages/Login';
import { restoreAuth } from './services/authStorage';
import api from './services/api';
import { getStoredTheme, initializeTheme, THEME_UPDATED_EVENT } from './services/theme';

// Auth Guard Component
const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const token = localStorage.getItem('token');
  if (!token) {
    const search = location?.search || '';
    return <Navigate to={`/login${search}`} replace />;
  }
  return children;
};

function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Customize Status Bar for iOS
    const configureStatusBar = async () => {
      try {
        const applyStatusBarStyle = async () => {
          const theme = getStoredTheme();
          await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark });
        };

        initializeTheme();
        await applyStatusBarStyle();
        const handleThemeUpdated = () => applyStatusBarStyle();
        window.addEventListener(THEME_UPDATED_EVENT, handleThemeUpdated);
        return () => window.removeEventListener(THEME_UPDATED_EVENT, handleThemeUpdated);
      } catch (err) {
        console.log("Status Bar plugin not available (web mode)", err);
      }
    };
    const cleanupPromise = configureStatusBar();
    return () => {
      Promise.resolve(cleanupPromise).then((cleanup) => cleanup && cleanup()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const hydrateAuth = async () => {
      let restored = await restoreAuth();
      if (!restored.token && Capacitor.isNativePlatform()) {
        // On some iOS cold starts, Preferences can lag by a few ms.
        await new Promise((resolve) => setTimeout(resolve, 250));
        restored = await restoreAuth();
      }
      if (restored.token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${restored.token}`;
      }
      setAuthReady(true);
    };
    hydrateAuth();
  }, []);

  if (!authReady) {
    return null;
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="portfolio" element={<Portfolio />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
