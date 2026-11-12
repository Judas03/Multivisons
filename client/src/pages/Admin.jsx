import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, FileText, Users, Search, ShieldAlert, Bot, Wallet, PenLine, Paperclip, PauseCircle, ChevronRight } from 'lucide-react';
import { api, dateTime, money } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import './admin.css';

function Stat({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`stat card ${tone || ''}`}>
      <div className="stat-ico"><Icon size={18} /></div>
      <div>
        <div className="stat-val">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="small muted">{sub}</div>}
      </div>
    </div>
  );
}

function Overview() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/stats').then(setS).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const statuses = ['DRAFT', 'AWAITING_SIGNATURES', 'ACTIVE', 'COMPLETED'];
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat icon={Users} label="Accounts" value={s.users} />
        <Stat icon={FileText} label="Agreements" value={s.agreements} />
        <Stat icon={PenLine} label="Signatures" value={s.signatures} />
        <Stat icon={Paperclip} label="Uploaded files" value={s.files} />
        <Stat icon={Bot} label="Average AI score" value={s.avgAiPercent == null ? 'n/a' : `${s.avgAiPercent}%`} sub={`${s.aiChecks.ai} AI model, ${s.aiChecks.heuristic} keyword`} />
        <Stat icon={PauseCircle} label="Payments on hold" value={s.holds} tone={s.holds ? 'warn' : ''} />
        <Stat icon={Wallet} label="Paid out" value={money(s.paidCents)} sub={`of ${money(s.valueCents)} contracted`} />
      </div>

      <section className="card stack">
        <h3>Agreements by stage</h3>
        <div className="stages">
          {statuses.map((k) => (
            <div key={k} className="stage">
              <StatusBadge status={k} />
              <strong>{s.byStatus[k] || 0}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h3>Latest activity across all projects</h3>
        {s.recent.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="timeline">
          {s.recent.map((e, i) => (
            <li key={i}>
              <span className="muted small">{dateTime(e.at)}</span>{' '}
              <Link to={`/admin/agreements/${e.agreementId}`}>{e.title}</Link>: {e.detail || e.type}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Agreements() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/agreements').then((d) => setRows(d.agreements)).catch((e) => setError(e.message)); }, []);
  const shown = useMemo(
    () => (rows || []).filter((r) => (status === 'ALL' || r.status === status) && `${r.title} ${r.client} ${r.contractor}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q, status],
  );
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <div className="row gap toolbar">
        <label className="search"><Search size={16} /><input placeholder="Search title or email" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by stage">
          <option value="ALL">All stages</option>
          <option value="DRAFT">Draft</option>
          <option value="AWAITING_SIGNATURES">Awaiting signatures</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>
      {shown.length === 0 && <div className="card muted">No agreements match.</div>}
      {shown.map((r) => (
        <Link key={r.id} to={`/admin/agreements/${r.id}`} className="card list-item admin-row">
          <div>
            <h3>{r.title} {r.held && <span className="badge ai_hold">Payment held</span>}</h3>
            <p className="muted small">{r.client} (client) and {r.contractor} (contractor) · updated {dateTime(r.updatedAt)}</p>
            <p className="small">Now: <strong>{r.currentStep}</strong> · step {r.stepsDone} of {r.stepsTotal}</p>
            <ProgressBar value={(r.stepsDone / r.stepsTotal) * 100} label="Process steps done" />
          </div>
          <div className="row gap">
            <div className="right"><strong>{money(r.totalCents)}</strong><div className="small muted">paid {money(r.paidCents)}</div></div>
            <StatusBadge status={r.status} />
            <ChevronRight size={18} className="muted" />
          </div>
        </Link>
      ))}
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/users').then((d) => setRows(d.users)).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>PayPal email</th><th>As client</th><th>As contractor</th><th>Joined</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.email}</td>
              <td><span className={`badge ${u.role === 'admin' ? 'active' : ''}`}>{u.role}</span></td>
              <td>{u.paypalEmail || <span className="muted">not set</span>}</td>
              <td>{u.asClient}</td><td>{u.asContractor}</td><td>{dateTime(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, view: Overview },
  { key: 'agreements', label: 'Agreements', icon: FileText, view: Agreements },
  { key: 'users', label: 'Accounts', icon: Users, view: UsersTab },
];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const View = TABS.find((t) => t.key === tab).view;
  return (
    <div className="stack">
      <div className="row between page-head">
        <div>
          <h1>Admin panel</h1>
          <p className="muted row gap"><ShieldAlert size={15} /> Read-only view of every account, agreement and process step.</p>
        </div>
      </div>
      <div className="tabs wide" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <View />
    </div>
  );
}
