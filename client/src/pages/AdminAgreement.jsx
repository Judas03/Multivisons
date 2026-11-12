import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, Loader, AlertTriangle, ShieldCheck, ShieldAlert, Paperclip, Download, Bot, Wallet } from 'lucide-react';
import { api, dateTime, fileSize, money } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import './admin.css';

function Step({ s, last }) {
  const Icon = s.warn ? AlertTriangle : s.state === 'done' ? Check : s.state === 'current' ? Loader : Circle;
  return (
    <li className={`step ${s.state} ${s.warn ? 'warn' : ''}`}>
      <div className="step-rail"><span className="step-dot"><Icon size={14} /></span>{!last && <span className="step-line" />}</div>
      <div className="step-body">
        <strong>{s.label}</strong>
        <div className="small muted">
          {s.at ? dateTime(s.at) : s.state === 'current' ? 'In progress' : 'Waiting'}
          {s.detail ? ` · ${s.detail}` : ''}
        </div>
      </div>
    </li>
  );
}

export default function AdminAgreement() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/admin/agreements/${id}`).then(setD).catch((e) => setError(e.message)); }, [id]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  const { agreement: a, steps, verify, client, contractor } = d;
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="stack">
      <Link to="/admin" className="btn ghost back"><ArrowLeft size={16} /> All agreements</Link>
      <div className="row between page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted">Version {a.version} · total {money(a.totalCents)} · paid {money(a.paidCents)}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <div className="grid two">
        <section className="card stack">
          <h3>Process steps</h3>
          <ProgressBar value={(done / steps.length) * 100} label="Process steps done" />
          <p className="small muted">{done} of {steps.length} steps complete</p>
          <ol className="steps-list">{steps.map((s, i) => <Step key={s.key} s={s} last={i === steps.length - 1} />)}</ol>
        </section>

        <div className="stack">
          <section className="card stack">
            <h3>Parties</h3>
            {[['Client', client, a.client], ['Contractor', contractor, a.contractor]].map(([label, u, p]) => (
              <div key={label} className="party">
                <p className="eyebrow">{label}</p>
                <strong>{u?.name || 'Not registered yet'}</strong>
                <span className="small muted">{p?.email}{u ? ` · joined ${dateTime(u.createdAt)}` : ''}</span>
              </div>
            ))}
          </section>

          <section className="card stack">
            <div className="row between">
              <h3>Signature verification</h3>
              {verify.contentHash && (
                <span className={`row gap small ${verify.allValid ? 'ok' : 'bad'}`}>
                  {verify.allValid ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
                  {verify.signatures.length === 0 ? 'No signatures yet' : verify.allValid ? 'All seals valid' : 'Problem found'}
                </span>
              )}
            </div>
            <p className="small muted">Content intact: <strong className={verify.contentIntact ? 'ok' : 'bad'}>{verify.contentIntact ? 'yes' : 'NO, terms changed after locking'}</strong></p>
            {verify.contentHash && <code>{verify.contentHash}</code>}
            {verify.signatures.map((s) => (
              <p key={s.role} className="small">
                <strong>{s.role}</strong> {s.name}, {dateTime(s.signedAt)}:{' '}
                <span className={s.sealValid && s.markIntact && s.matchesCurrentContent ? 'ok' : 'bad'}>
                  {s.sealValid && s.markIntact && s.matchesCurrentContent ? 'seal valid' : 'seal mismatch'}
                </span>
              </p>
            ))}
          </section>
        </div>
      </div>

      <section className="card stack">
        <h3>Milestones and AI checks</h3>
        {a.milestones.map((m, i) => (
          <div key={i} className={`milestone ${m.status.toLowerCase()}`}>
            <div className="row between">
              <h4>{i + 1}. {m.title}</h4>
              <div className="row gap"><strong>{money(m.amountCents)}</strong><StatusBadge status={m.status} /></div>
            </div>
            {m.criteria && <p className="muted small pre">{m.criteria}</p>}
            {m.assessment ? (
              <div className="assess">
                <div className="row between">
                  <strong className="row gap"><Bot size={16} /> {m.assessment.percent}% complete · {m.assessment.decision.replace('_', ' ').toLowerCase()}</strong>
                  <span className="small muted">{m.assessment.mode === 'ai' ? 'AI model' : 'Keyword check'}</span>
                </div>
                <ProgressBar value={m.assessment.percent} threshold={m.assessment.threshold} tone={m.assessment.percent >= m.assessment.threshold ? 'good' : 'warn'} label="AI completion" />
                <p className="small">{m.assessment.summary}</p>
                <ul className="criteria">
                  {m.assessment.criteria.map((c, k) => <li key={k} className={c.met ? 'ok' : 'bad'}>{c.met ? 'Met' : 'Not met'}: {c.criterion}</li>)}
                </ul>
              </div>
            ) : <p className="muted small">No submission yet.</p>}
            {m.payment && (
              <p className="small ok row gap"><Wallet size={15} /> {money(m.payment.amountCents)} via {m.payment.mode}, approved by {m.approvedBy}, ref {m.payment.reference}</p>
            )}
          </div>
        ))}
      </section>

      <div className="grid two">
        <section className="card stack">
          <h3>Files</h3>
          {a.files.length === 0 && <p className="muted small">No files uploaded.</p>}
          <ul className="files">
            {a.files.map((f) => (
              <li key={f.id}>
                <Paperclip size={14} /> <a href={`/api/admin/agreements/${a.id}/files/${f.id}`} download>{f.name}</a>
                <span className="muted small">{fileSize(f.size)} · {f.role}{f.milestone != null ? ` · milestone ${f.milestone + 1}` : ' · project brief'}</span>
                <Download size={14} className="muted" />
              </li>
            ))}
          </ul>
        </section>
        <section className="card stack">
          <h3>Audit trail</h3>
          <ul className="timeline">
            {[...a.events].reverse().map((e, i) => <li key={i}><span className="muted small">{dateTime(e.at)}</span> {e.detail || e.type}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
