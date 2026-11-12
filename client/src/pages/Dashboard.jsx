import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, FileText, ChevronRight } from 'lucide-react';
import { api, dateTime, money } from '../lib/api.js';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Dashboard() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/agreements').then((d) => setItems(d.agreements)).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="row between page-head">
        <h1>Your agreements</h1>
        <Link to="/app/new" className="btn primary"><Plus size={16} /> New agreement</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && (
        <div className="card empty">
          <FileText size={32} />
          <h3>No agreements yet</h3>
          <p className="muted">Start one and invite the person you will work with by email.</p>
          <Link to="/app/new" className="btn primary">Create your first agreement</Link>
        </div>
      )}
      <div className="stack">
        {items?.map((a) => (
          <Link key={a.id} to={a.status === 'DRAFT' ? `/app/${a.id}/edit` : `/app/${a.id}`} className="card list-item">
            <div>
              <h3>{a.title}</h3>
              <p className="muted small">
                You are the {a.myRole} · with {a.myRole === 'client' ? a.contractor.email : a.client.email} · updated {dateTime(a.updatedAt)}
              </p>
              <ProgressBar value={a.progressPct} label="Project progress" />
            </div>
            <div className="row gap">
              <strong>{money(a.totalCents)}</strong>
              <StatusBadge status={a.status} />
              <ChevronRight size={18} className="muted" />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
