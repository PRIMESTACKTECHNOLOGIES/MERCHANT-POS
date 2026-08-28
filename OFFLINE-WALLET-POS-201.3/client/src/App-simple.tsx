// SIMPLIFIED APP FOR TESTING - NO IMPORTS
import { Routes, Route, Navigate } from "react-router-dom";

// Ultra simple pages with no external dependencies
const SimpleTest = () => (
  <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
    <h1 style={{ color: '#2563eb' }}>✅ React is Working!</h1>
    <p>The React app is rendering correctly.</p>
    <p>If you see this, the problem is with one of the imported components.</p>
    <a href="/simple-dash" style={{ color: '#2563eb' }}>Try Simple Dashboard →</a>
  </div>
);

const SimpleDashboard = () => (
  <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
    {/* Sidebar */}
    <div style={{ width: 260, background: '#fff', borderRight: '1px solid #e5e7eb', padding: 20 }}>
      <h2 style={{ color: '#2563eb' }}>POS 201.3</h2>
      <nav style={{ marginTop: 20 }}>
        <a href="/simple-dash" style={{ display: 'block', padding: '10px', color: '#4b5563', textDecoration: 'none' }}>Dashboard</a>
        <a href="/simple-test" style={{ display: 'block', padding: '10px', color: '#4b5563', textDecoration: 'none' }}>Test Page</a>
      </nav>
    </div>
    {/* Main */}
    <div style={{ flex: 1, padding: 40, background: '#f4f6f8' }}>
      <h1>Dashboard Overview</h1>
      <p>This is a simplified dashboard without all the complex components.</p>
      <div style={{ background: '#fff', padding: 20, borderRadius: 12, marginTop: 20 }}>
        <p>Everything seems to be working!</p>
        <a href="/overview" style={{ color: '#2563eb' }}>Try Full Dashboard →</a>
      </div>
    </div>
  </div>
);

function App() {
  console.log("[App-simple.tsx] Rendering...");
  
  return (
    <Routes>
      <Route path="/simple-test" element={<SimpleTest />} />
      <Route path="/simple-dash" element={<SimpleDashboard />} />
      <Route path="/" element={<Navigate to="/simple-test" replace />} />
    </Routes>
  );
}

export default App;
