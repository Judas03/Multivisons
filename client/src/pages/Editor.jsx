import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { api, money } from '../lib/api.js';

const blank = { title: '', summary: '', terms: '', myRole: 'client', counterpartyEmail: '', milestones: [{ title: '', criteria: '', dollars: '' }] };

export default function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState(blank);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get(`/agreements/${id}`)
      .then(({ agreement: a }) => {
        if (a.status !== 'DRAFT') return nav(`/app/${id}`, { replace: true });
        setF({
          title: a.title,
          summary: a.summary,
          terms: a.terms,
          myRole: a.myRole,
          counterpartyEmail: (a.myRole === 'client' ? a.contractor : a.client).email,
          milestones: a.milestones.length
            ? a.milestones.map((m) => ({ title: m.title, criteria: m.criteria, dollars: (m.amountCents / 100).toString() }))
            : blank.milestones,
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, nav]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setM = (i, k, v) => setF({ ...f, milestones: f.milestones.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  const payload = () => ({
    title: f.title,
    summary: f.summary,
    terms: f.terms,
    counterpartyEmail: f.counterpartyEmail,
    ...(id ? {} : { myRole: f.myRole }),
    milestones: f.milestones
      .filter((m) => m.title.trim() || m.dollars)
      .map((m) => ({ title: m.title, criteria: m.criteria, amountCents: Math.round(Number(m.dollars) * 100) })),
  });
  const total = f.milestones.reduce((s, m) => s + Math.round((Number(m.dollars) || 0) * 100), 0);

  async function save(thenSend) {
    setError('');
    setBusy(true);
    try {
      const { agreement } = id ? await api.put(`/agreements/${id}`, payload()) : await api.post('/agreements', payload());
      if (thenSend) await api.post(`/agreements/${agreement.id}/send`);
      nav(thenSend ? `/app/${agreement.id}` : '/app');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <h1>{id ? 'Edit draft' : 'New agreement'}</h1>

      <section className="card stack">
        <label className="field"><span>Project title</span>
          <input value={f.title} onChange={set('title')} required maxLength={200} placeholder="e.g. Customer-support chatbot" />
        </label>
        <div className="grid two">
          <label className="field"><span>I am the</span>
            <select value={f.myRole} onChange={set('myRole')} disabled={!!id}>
              <option value="client">Client (paying for the work)</option>
              <option value="contractor">Contractor (doing the work)</option>
            </select>
          </label>
          <label className="field"><span>Other party's email</span>
            <input type="email" value={f.counterpartyEmail} onChange={set('counterpartyEmail')} required />
          </label>
        </div>
        <label className="field"><span>Summary</span>
          <textarea rows={3} value={f.summary} onChange={set('summary')} placeholder="What will be delivered, in plain words." />
        </label>
        <label className="field"><span>Terms</span>
          <textarea rows={6} value={f.terms} onChange={set('terms')} placeholder="Deadlines, revisions, ownership of the work, anything both sides expect." />
        </label>
      </section>

      <section className="card stack">
        <div className="row between">
          <h3>Milestones</h3>
          <strong>Total {money(total)}</strong>
        </div>
        {f.milestones.map((m, i) => (
          <div key={i} className="milestone-edit">
            <div className="grid two-1">
              <label className="field"><span>Title</span>
                <input value={m.title} onChange={(e) => setM(i, 'title', e.target.value)} required />
              </label>
              <label className="field"><span>Amount (USD)</span>
                <input type="number" min="0.01" step="0.01" value={m.dollars} onChange={(e) => setM(i, 'dollars', e.target.value)} required />
              </label>
            </div>
            <label className="field"><span>Acceptance criteria</span>
              <textarea rows={2} value={m.criteria} onChange={(e) => setM(i, 'criteria', e.target.value)} placeholder="How will both sides know this is done?" />
            </label>
            {f.milestones.length > 1 && (
              <button type="button" className="btn ghost danger" onClick={() => setF({ ...f, milestones: f.milestones.filter((_, j) => j !== i) })}>
                <Trash2 size={16} /> Remove
              </button>
            )}
          </div>
        ))}
        {f.milestones.length < 12 && (
          <button type="button" className="btn" onClick={() => setF({ ...f, milestones: [...f.milestones, { title: '', criteria: '', dollars: '' }] })}>
            <Plus size={16} /> Add milestone
          </button>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row gap">
        <button className="btn" disabled={busy}><Save size={16} /> Save draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>
          <Send size={16} /> Save and lock for signatures
        </button>
      </div>
    </form>
  );
}
