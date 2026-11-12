import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, Mail, Lock, User, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, login, register } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '', paypalEmail: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={loc.state?.from || '/app'} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) await register(form);
      else await login(form.email, form.password);
      nav('/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth card">
      <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted">
        {isRegister ? 'Both the client and the contractor need an account. Use the email address the other person will invite.' : 'Sign in to continue to your agreements.'}
      </p>
      <form onSubmit={submit} className="stack">
        {isRegister && (
          <label className="field">
            <span><User size={14} /> Full name (appears on your signature)</span>
            <input value={form.name} onChange={set('name')} required autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span><Mail size={14} /> Email</span>
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label className="field">
          <span><Lock size={14} /> Password {isRegister && '(8+ characters)'}</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={isRegister ? 8 : 1}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
        </label>
        {isRegister && (
          <label className="field">
            <span><Wallet size={14} /> PayPal email (optional, where you receive milestone payments)</span>
            <input type="email" value={form.paypalEmail} onChange={set('paypalEmail')} autoComplete="off" />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy}>
          {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />} {isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="muted small">
        {isRegister ? (<>Already registered? <Link to="/login">Sign in</Link></>) : (<>New here? <Link to="/register">Create an account</Link></>)}
      </p>
    </div>
  );
}
