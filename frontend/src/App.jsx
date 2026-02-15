import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { StatusBar, Style } from '@capacitor/status-bar';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Discovery from './pages/Discovery';
import Portfolio from './pages/Portfolio';
import Login from './pages/Login';

// Auth Guard Component
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  useEffect(() => {
    // Customize Status Bar for iOS
    const configureStatusBar = async () => {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        // Optional: Set background color if needed for Android/other platforms
        // await StatusBar.setBackgroundColor({ color: '#0f1115' });
      } catch (err) {
        console.log("Status Bar plugin not available (web mode)", err);
      }
    };
    configureStatusBar();
  }, []);

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
