import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Editor from './pages/Editor.jsx';
import Admin from './pages/Admin.jsx';
import AdminAgreement from './pages/AdminAgreement.jsx';
import AgreementPage from './pages/AgreementPage.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'admin' ? children : <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/app" element={<Protected><Dashboard /></Protected>} />
        <Route path="/app/new" element={<Protected><Editor /></Protected>} />
        <Route path="/app/:id/edit" element={<Protected><Editor /></Protected>} />
        <Route path="/app/:id" element={<Protected><AgreementPage /></Protected>} />
        <Route path="/admin" element={<AdminOnly><Admin /></AdminOnly>} />
        <Route path="/admin/agreements/:id" element={<AdminOnly><AdminAgreement /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
