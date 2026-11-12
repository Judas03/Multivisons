import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FileSignature, LogOut, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export function Logo() {
  return (
    <Link to="/" className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0f3d3e" />
        <path d="M7 22V10l9 8 9-8v12" fill="none" stroke="#f4b942" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Multivisons</span>
    </Link>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const home = useLocation().pathname === '/';
  return (
    <>
      <header className="topbar">
        <div className="wrap row between">
          <Logo />
          <nav className="row gap">
            {user ? (
              <>
                {user.role === 'admin' && <NavLink to="/admin" className="navlink"><ShieldCheck size={16} /> Admin</NavLink>}
                <NavLink to="/app" className="navlink"><LayoutDashboard size={16} /> Agreements</NavLink>
                <NavLink to="/app/new" className="navlink"><FileSignature size={16} /> New</NavLink>
                <span className="muted hide-sm">{user.name}</span>
                <button className="btn ghost" onClick={async () => { await logout(); nav('/'); }}>
                  <LogOut size={16} /> Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="navlink">Sign in</Link>
                <Link to="/register" className="btn primary">Create account</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className={home ? 'full' : 'wrap'}>{children}</main>
      <footer className="wrap foot muted">
        Hackathon prototype. Not escrow, not a legal service. Payments shown are simulated sandbox actions.
      </footer>
    </>
  );
}
