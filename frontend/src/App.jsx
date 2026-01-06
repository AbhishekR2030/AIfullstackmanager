import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Discovery from './pages/Discovery';
import Portfolio from './pages/Portfolio';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/portfolio" element={<Portfolio />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
