import { useRef, useState } from 'react';
import { PenLine, Type, Eraser, X, Lock } from 'lucide-react';
import SignaturePad from './SignaturePad.jsx';
import { api } from '../lib/api.js';

export default function SignDialog({ agreement, user, onClose, onSigned }) {
  const pad = useRef(null);
  const [method, setMethod] = useState('draw');
  const [typed, setTyped] = useState(user.name);
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (method === 'draw' && pad.current.isEmpty()) return setError('Draw your signature in the box first.');
    setBusy(true);
    try {
      const mark = method === 'draw' ? pad.current.toDataURL() : typed;
      const { agreement: a } = await api.post(`/agreements/${agreement.id}/sign`, { method, mark, password, consent });
      onSigned(a);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Sign agreement">
      <form className="dialog stack" onSubmit={submit}>
        <div className="row between">
          <h2>Sign as {agreement.myRole}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted small">
          You are signing version {agreement.version}, fingerprint <code>{agreement.contentHash.slice(0, 16)}</code>.
          If anything changes, this signature no longer applies.
        </p>

        <div className="tabs">
          <button type="button" className={method === 'draw' ? 'active' : ''} onClick={() => setMethod('draw')}><PenLine size={15} /> Draw</button>
          <button type="button" className={method === 'type' ? 'active' : ''} onClick={() => setMethod('type')}><Type size={15} /> Type</button>
        </div>

        {method === 'draw' ? (
          <div>
            <SignaturePad ref={pad} />
            <button type="button" className="btn ghost" onClick={() => pad.current.clear()}><Eraser size={15} /> Clear</button>
          </div>
        ) : (
          <div>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} minLength={2} required aria-label="Typed signature" />
            <div className="typed-preview">{typed || ' '}</div>
          </div>
        )}

        <label className="field"><span><Lock size={14} /> Confirm with your password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>I have read this agreement and intend this mark to be my electronic signature.</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !consent}><PenLine size={18} /> Sign agreement</button>
      </form>
    </div>
  );
}
