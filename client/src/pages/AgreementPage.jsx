import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PenLine, Pencil, Undo2, ShieldCheck, ShieldAlert, CheckCircle2, Circle, Upload, ThumbsUp, MessageSquareWarning,
  Hash, Paperclip, Download, Sparkles, Bot, Wallet, Check, X as XIcon,
} from 'lucide-react';
import { api, dateTime, fileSize, money } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import SignDialog from '../components/SignDialog.jsx';
import ProgressBar from '../components/ProgressBar.jsx';

function FileList({ a, files }) {
  if (!files.length) return null;
  return (
    <ul className="files">
      {files.map((f) => (
        <li key={f.id}>
          <Paperclip size={14} />
          <a href={`/api/agreements/${a.id}/files/${f.id}`} download>{f.name}</a>
          <span className="muted small">{fileSize(f.size)} · {f.role} · {dateTime(f.at)}</span>
          <Download size={14} className="muted" />
        </li>
      ))}
    </ul>
  );
}

function Assessment({ m }) {
  const s = m.assessment;
  if (!s) return null;
  const tone = s.percent >= s.threshold ? 'good' : s.percent >= 50 ? 'warn' : 'low';
  return (
    <div className="assess">
      <div className="row between">
        <strong className="row gap"><Bot size={16} /> AI completion check</strong>
        <span className="small muted">{s.mode === 'ai' ? 'AI model' : 'Keyword check (no AI key configured)'}</span>
      </div>
      <ProgressBar value={s.percent} tone={tone} threshold={s.threshold} label="Completion against agreed terms" />
      <p className="small">{s.summary}</p>
      <ul className="criteria">
        {s.criteria.map((c, i) => (
          <li key={i} className={c.met ? 'ok' : 'bad'}>
            {c.met ? <Check size={14} /> : <XIcon size={14} />} <span>{c.criterion}</span>
            {c.note && <span className="muted small"> — {c.note}</span>}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Payment releases at {s.threshold}% or more.{' '}
        {s.decision === 'RELEASE' && 'The check passed and payment was released automatically.'}
        {s.decision === 'RECOMMEND_RELEASE' && 'Passed, but this check is not an AI model, so the client confirms the payment.'}
        {s.decision === 'HOLD' && 'Below the threshold, so payment is on hold until the work is resubmitted or the client decides.'}
      </p>
    </div>
  );
}

function Milestone({ a, m, i, role, onChange }) {
  const fileRef = useRef(null);
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState([]);
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = a.status === 'ACTIVE' && a.milestones.findIndex((x) => x.status !== 'APPROVED') === i;
  const files = a.files.filter((f) => f.milestone === i);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('note', note);
      if (url) fd.set('url', url);
      for (const f of picked) fd.append('files', f);
      onChange((await api.upload(`/agreements/${a.id}/milestones/${i}/submit`, fd)).agreement);
      setNote(''); setUrl(''); setPicked([]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function review(decision) {
    setError('');
    setBusy(true);
    try {
      onChange((await api.post(`/agreements/${a.id}/milestones/${i}/review`, { decision, note: reviewNote })).agreement);
      setReviewNote('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className={`milestone ${m.status.toLowerCase()}`}>
      <div className="row between">
        <h4>{m.status === 'APPROVED' ? <CheckCircle2 size={18} className="ok" /> : <Circle size={18} />} {i + 1}. {m.title}</h4>
        <div className="row gap"><strong>{money(m.amountCents)}</strong><StatusBadge status={m.status} /></div>
      </div>
      {m.criteria && <p className="muted pre small">{m.criteria}</p>}
      {m.evidence.map((ev, k) => (
        <div key={k} className="evidence small">
          <span className="muted">{dateTime(ev.at)}</span> {ev.note}
          {ev.url && <> · <a href={ev.url} target="_blank" rel="noreferrer noopener">link</a></>}
        </div>
      ))}
      <FileList a={a} files={files} />
      <Assessment m={m} />
      {m.reviewNote && <p className="small muted">Client note: {m.reviewNote}</p>}
      {m.payment && (
        <p className="small ok row gap">
          <Wallet size={15} />
          {m.payment.mode === 'paypal-sandbox' ? 'PayPal sandbox payout' : 'Simulated PayPal sandbox payment'} of {money(m.payment.amountCents)}
          {m.approvedBy === 'ai' ? ' released by the AI check' : ' approved by the client'} · ref {m.payment.reference}
        </p>
      )}

      {active && role === 'contractor' && ['PENDING', 'CHANGES_REQUESTED', 'AI_HOLD'].includes(m.status) && (
        <div className="stack top">
          <textarea rows={2} placeholder="Describe what you are submitting and how it meets the criteria" value={note} onChange={(e) => setNote(e.target.value)} />
          <input type="url" placeholder="Link to the live project or repository (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="row gap">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => setPicked([...e.target.files].slice(0, 5))} />
            <button type="button" className="btn" onClick={() => fileRef.current.click()}><Paperclip size={16} /> Attach project files</button>
            {picked.map((f) => <span key={f.name} className="chip">{f.name}</span>)}
          </div>
          <button className="btn primary" disabled={busy || !note.trim()} onClick={submit}>
            <Sparkles size={16} /> {busy ? 'AI is checking your work…' : 'Submit for AI check'}
          </button>
        </div>
      )}
      {active && role === 'client' && ['SUBMITTED', 'AI_HOLD'].includes(m.status) && (
        <div className="stack top">
          <input placeholder="Optional note to the contractor" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          <div className="row gap">
            <button className="btn primary" disabled={busy} onClick={() => review('approve')}>
              <ThumbsUp size={16} /> {m.status === 'AI_HOLD' ? 'Override and pay' : 'Approve and pay'} {money(m.amountCents)}
            </button>
            <button className="btn" disabled={busy} onClick={() => review('request_changes')}>
              <MessageSquareWarning size={16} /> Request changes
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ProjectFiles({ a, onChange }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const brief = a.files.filter((f) => f.milestone == null);

  async function add(e) {
    const fd = new FormData();
    for (const f of [...e.target.files].slice(0, 5)) fd.append('files', f);
    e.target.value = '';
    setError('');
    setBusy(true);
    try { onChange((await api.upload(`/agreements/${a.id}/files`, fd)).agreement); } catch (er) { setError(er.message); } finally { setBusy(false); }
  }

  return (
    <section className="card stack">
      <div className="row between">
        <h3>Project files</h3>
        {a.status !== 'COMPLETED' && (
          <>
            <input ref={ref} type="file" multiple hidden onChange={add} />
            <button className="btn" disabled={busy} onClick={() => ref.current.click()}><Upload size={16} /> Upload project files</button>
          </>
        )}
      </div>
      <p className="muted small">Briefs, designs and reference material from either party. The AI check reads text files when scoring deliveries. Max 10 MB each.</p>
      {brief.length ? <FileList a={a} files={brief} /> : <p className="muted small">No files uploaded yet.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export default function AgreementPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [a, setA] = useState(null);
  const [verify, setVerify] = useState(null);
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(false);

  const refreshVerify = useCallback(() => api.get(`/agreements/${id}/verify`).then(setVerify).catch(() => {}), [id]);

  useEffect(() => {
    api.get(`/agreements/${id}`).then((d) => setA(d.agreement)).catch((e) => setError(e.message));
    refreshVerify();
  }, [id, refreshVerify]);

  if (error) return <p className="error">{error}</p>;
  if (!a) return <p className="muted">Loading…</p>;

  const update = (next) => { setA(next); refreshVerify(); };
  const signed = (role) => a.signatures.find((s) => s.role === role);
  const iSigned = !!signed(a.myRole);

  return (
    <div className="stack">
      <div className="row between page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted">Version {a.version} · you are the {a.myRole} · total <strong>{money(a.totalCents)}</strong> · paid {money(a.paidCents)}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {['ACTIVE', 'COMPLETED'].includes(a.status) && (
        <section className="card stack">
          <div className="row between"><h3>Project progress</h3><span className="muted small">Approved milestones plus the latest AI score on the open one</span></div>
          <ProgressBar value={a.progressPct} tone={a.progressPct === 100 ? 'good' : ''} label="Overall project progress" />
        </section>
      )}

      {a.status === 'AWAITING_SIGNATURES' && (
        <div className="card banner row between">
          <div>
            <h3>{iSigned ? 'Waiting for the other party to sign' : 'Your signature is needed'}</h3>
            <p className="muted small">The content is locked. Reopening creates a new version and clears signatures.</p>
          </div>
          <div className="row gap">
            <button className="btn" onClick={async () => update((await api.post(`/agreements/${a.id}/reopen`)).agreement)}><Undo2 size={16} /> Reopen to edit</button>
            {!iSigned && <button className="btn primary" onClick={() => setSigning(true)}><PenLine size={16} /> Review and sign</button>}
          </div>
        </div>
      )}
      {a.status === 'DRAFT' && (
        <div className="card banner row between">
          <p>This draft is not locked yet.</p>
          <Link to={`/app/${a.id}/edit`} className="btn primary"><Pencil size={16} /> Continue editing</Link>
        </div>
      )}

      <section className="card stack">
        <h3>Scope</h3>
        {a.summary && <p className="pre">{a.summary}</p>}
        {a.terms && <><h4>Terms</h4><p className="pre">{a.terms}</p></>}
        <p className="muted small">Client: {a.client.email} · Contractor: {a.contractor.email}</p>
      </section>

      <ProjectFiles a={a} onChange={update} />

      <section className="card stack">
        <h3>Milestones</h3>
        {a.milestones.map((m, i) => <Milestone key={i} a={a} m={m} i={i} role={a.myRole} onChange={update} />)}
        <p className="muted small">
          The AI checks each delivery against the signed acceptance criteria; fixed rules decide the release. Payment is always the signed amount.
          Payouts use the PayPal sandbox when configured, otherwise they are simulated and labelled.
        </p>
      </section>

      <section className="card stack">
        <div className="row between">
          <h3>Signatures</h3>
          {verify?.contentHash && (
            <span className={`row gap small ${verify.allValid ? 'ok' : 'bad'}`}>
              {verify.allValid ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
              {verify.signatures.length === 0 ? 'No signatures yet' : verify.allValid ? 'All seals verified' : 'Verification problem'}
            </span>
          )}
        </div>
        {a.contentHash && <p className="small muted row gap"><Hash size={14} /> Content fingerprint <code>{a.contentHash}</code></p>}
        <div className="grid two">
          {['client', 'contractor'].map((role) => {
            const s = signed(role);
            const v = verify?.signatures.find((x) => x.role === role);
            return (
              <div key={role} className="sigbox">
                <p className="eyebrow">{role}</p>
                {s ? (
                  <>
                    {s.method === 'draw' ? <img src={s.mark} alt={`${s.name}'s signature`} /> : <div className="typed-preview">{s.mark}</div>}
                    <p className="small"><strong>{s.name}</strong><br /><span className="muted">{dateTime(s.signedAt)}</span></p>
                    {v && <p className={`small ${v.sealValid && v.markIntact && v.matchesCurrentContent ? 'ok' : 'bad'}`}>
                      {v.sealValid && v.markIntact && v.matchesCurrentContent ? 'Seal valid for this version' : 'Seal does not match'}
                    </p>}
                  </>
                ) : <p className="muted">Not signed yet</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card stack">
        <h3>Activity</h3>
        <ul className="timeline">
          {[...a.events].reverse().map((e, i) => (
            <li key={i}><span className="muted small">{dateTime(e.at)}</span> {e.detail || e.type}</li>
          ))}
        </ul>
      </section>

      {signing && (
        <SignDialog agreement={a} user={user} onClose={() => setSigning(false)} onSigned={(next) => { setSigning(false); update(next); }} />
      )}
    </div>
  );
}
