import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, MessagesSquare, ScrollText, PenLine, ShieldCheck, BadgeDollarSign, Bot, Upload, Fingerprint,
  ClipboardCheck, Wallet, Eye, Users, Briefcase, Building2, Check, ChevronDown, FileSearch, Lock, History, Gauge,
} from 'lucide-react';
import HowItWorks from '../components/HowItWorks.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import './landing.css';

const Screen = ({ id, tone, children }) => (
  <section id={id} className={`screen ${tone || ''}`}>
    <div className="wrap screen-in">{children}</div>
  </section>
);

const Head = ({ eyebrow, title, text }) => (
  <header className="sec-head">
    <p className="eyebrow">{eyebrow}</p>
    <h2>{title}</h2>
    {text && <p className="lead">{text}</p>}
  </header>
);

/* ---------- 1. hero ---------- */
function Hero() {
  return (
    <Screen id="top" tone="hero-screen">
      <div className="hero-grid">
        <div className="stack hero-copy">
          <p className="eyebrow">Client and contractor agree first, then AI-checked milestone payments</p>
          <h1>Sign the scope. Upload the project. Get paid when the work meets the terms.</h1>
          <p className="lead">
            Both sides create an account and sign one locked agreement. The contractor uploads the work, our AI scores it against
            the agreed criteria with a clear completion bar, and PayPal pays the milestone when it passes.
          </p>
          <div className="row gap">
            <Link to="/register" className="btn primary lg">Create your account <ArrowRight size={18} /></Link>
            <a href="#how" className="btn lg">See how it works</a>
          </div>
          <ul className="hero-points">
            <li><Check size={16} /> Signatures with tamper-evident seals</li>
            <li><Check size={16} /> Fixed-price milestones, paid in order</li>
            <li><Check size={16} /> Admin oversight of every step</li>
          </ul>
        </div>

        <div className="hero-card" aria-hidden="true">
          <div className="hc-top">
            <div><strong>Customer-support chatbot</strong><div className="small muted">Client Ada, Contractor Bo</div></div>
            <span className="badge active">Active</span>
          </div>
          <div className="hc-row"><span>Project progress</span><strong>62%</strong></div>
          <div className="progress-track"><div className="progress-fill hc-fill" /></div>
          <div className="hc-ms done"><Check size={15} /> Prototype <span>$40.00</span></div>
          <div className="hc-ms now"><span className="hc-pulse" /> Working build <span>$110.00</span></div>
          <div className="hc-ai">
            <div className="row gap small"><Bot size={15} /> AI check: 3 of 4 criteria met</div>
            <div className="sk" style={{ height: 8, width: '80%' }} />
            <div className="sk" style={{ height: 8, width: '55%', animationDelay: '200ms' }} />
          </div>
          <div className="hc-float f1"><PenLine size={15} /> Both signed</div>
          <div className="hc-float f2"><Wallet size={15} /> $40 released</div>
        </div>
      </div>
      <a href="#how" className="scroll-cue" aria-label="Scroll to how it works"><ChevronDown size={22} /></a>
    </Screen>
  );
}

/* ---------- 2. how it works ---------- */
function How() {
  return (
    <Screen id="how">
      <Head eyebrow="How it works" title="Five steps from handshake to payment" text="Watch the flow play out. Hover to pause, or pick any step." />
      <HowItWorks />
      <div className="mini-stats">
        {[['2', 'accounts needed, one per side'], ['1', 'locked version both sign'], ['85%', 'default score needed to release pay'], ['0', 'payments without the signed amount']].map(([n, t]) => (
          <div key={t}><strong>{n}</strong><span>{t}</span></div>
        ))}
      </div>
    </Screen>
  );
}

/* ---------- 3. features ---------- */
const FEATURES = [
  { icon: MessagesSquare, title: 'Shared scope and milestones', text: 'Write the summary, terms and fixed-price milestones together. Every milestone has plain acceptance criteria, so nobody argues later about what done means.' },
  { icon: Fingerprint, title: 'Locked, fingerprinted versions', text: 'Sending for signature freezes the content and stores a SHA-256 fingerprint. A change means a new version and fresh signatures from both sides.' },
  { icon: PenLine, title: 'Draw or type your signature', text: 'Sign with a mouse, finger or pen, or type it. You confirm with your password and tick a consent box. The server seals your name, time and mark.' },
  { icon: Upload, title: 'Project uploads', text: 'Either party uploads briefs and references. The contractor attaches the finished work to each milestone, up to 10 MB per file, with executables blocked.' },
  { icon: Bot, title: 'AI completion bar', text: 'Each delivery is scored criterion by criterion, then shown as a percentage against your release threshold. The reasons are visible, not hidden.' },
  { icon: Wallet, title: 'PayPal milestone payouts', text: 'At the threshold the signed amount is paid through the PayPal sandbox. Below it, payment is held and the client can override or ask for changes.' },
];

function Features() {
  return (
    <Screen id="features" tone="alt">
      <Head eyebrow="What you get" title="Everything two people need to work together safely" text="Small enough for one freelancer and one client. Careful enough that both can trust the record." />
      <div className="grid feat">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <article key={title} className="card feat-card">
            <div className="icon-badge"><Icon size={20} /></div>
            <h3>{title}</h3>
            <p className="muted">{text}</p>
          </article>
        ))}
      </div>
    </Screen>
  );
}

/* ---------- 4. roles ---------- */
const CLIENT = ['Invite the contractor by email', 'Agree scope, terms and milestone amounts', 'Upload briefs, designs and reference files', 'Watch a progress bar fill as work lands', 'Override a held payment or request changes', 'Keep a verifiable record of what was agreed'];
const CONTRACTOR = ['Accept the invite with your own account', 'Sign only the exact version you reviewed', 'Submit files, notes and links per milestone', 'See which criteria the AI considered met', 'Get paid to your PayPal email on release', 'Resubmit quickly if a criterion was missed'];

function Roles() {
  return (
    <Screen id="roles">
      <Head eyebrow="Built for two sides" title="One account each, one shared source of truth" text="Whichever side you are on, you see the same agreement, the same fingerprint and the same progress." />
      <div className="grid two roles">
        <article className="card role-card">
          <div className="role-head"><span className="icon-badge"><Building2 size={20} /></span><div><h3>For the client</h3><p className="muted small">The person paying for the work</p></div></div>
          <ul className="ticks">{CLIENT.map((t) => <li key={t}><Check size={16} /> {t}</li>)}</ul>
        </article>
        <article className="card role-card">
          <div className="role-head"><span className="icon-badge"><Briefcase size={20} /></span><div><h3>For the contractor</h3><p className="muted small">The person doing the work</p></div></div>
          <ul className="ticks">{CONTRACTOR.map((t) => <li key={t}><Check size={16} /> {t}</li>)}</ul>
        </article>
      </div>
      <div className="role-strip">
        <Users size={18} /> Both parties must sign the same version before any work or payment can begin.
      </div>
    </Screen>
  );
}

/* ---------- 5. interactive AI check ---------- */
const CRITERIA = ['Visitors can log in', 'Chatbot answers the 20 agreed FAQs', 'Hands over to a human when unsure', 'Deployed and reachable online'];
const THRESHOLD = 85;

function AiCheck() {
  const [met, setMet] = useState([true, true, false, false]);
  const pct = Math.round((met.filter(Boolean).length / met.length) * 100);
  const pass = pct >= THRESHOLD;
  return (
    <Screen id="ai" tone="alt">
      <Head eyebrow="The AI check" title="See exactly why a payment was released or held" text="Tick the criteria to see how the completion bar and the decision react. In the real app, the AI reads the submission and sets each tick for you." />
      <div className="grid two ai-grid">
        <div className="card stack">
          <h3 className="row gap"><ClipboardCheck size={18} /> Milestone: Working build · $110.00</h3>
          {CRITERIA.map((c, i) => (
            <label key={c} className={`crit-toggle ${met[i] ? 'on' : ''}`}>
              <input type="checkbox" checked={met[i]} onChange={() => setMet(met.map((m, j) => (j === i ? !m : m)))} />
              <span className="box">{met[i] && <Check size={14} />}</span>
              <span>{c}</span>
            </label>
          ))}
        </div>
        <div className="card stack">
          <h3 className="row gap"><Gauge size={18} /> Completion against the terms</h3>
          <ProgressBar value={pct} tone={pass ? 'good' : pct >= 50 ? 'warn' : 'low'} threshold={THRESHOLD} label="Completion" />
          <div className={`decision ${pass ? 'go' : 'hold'}`}>
            {pass ? <><Wallet size={18} /> Payment released: $110.00 to the contractor</> : <><Lock size={18} /> Payment on hold until {THRESHOLD}% or the client decides</>}
          </div>
          <ul className="small muted bullets">
            <li>The amount is always the signed figure. The AI never sets it.</li>
            <li>The marker on the bar is the release threshold ({THRESHOLD}% by default).</li>
            <li>Without an AI key, a simple keyword check is used and is labelled as such.</li>
            <li>The client can always override a hold or ask for changes.</li>
          </ul>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- 6. payments ---------- */
const MILESTONES = [
  { t: 'Prototype', a: '$40.00', s: 'Paid', d: 'Clickable flow and FAQ data set', pct: 100, cls: 'done' },
  { t: 'Working build', a: '$110.00', s: 'AI check', d: 'Staging chatbot with human handoff', pct: 62, cls: 'now' },
  { t: 'Launch', a: '$150.00', s: 'Locked', d: 'Production deployment and test report', pct: 0, cls: '' },
];

function Payments() {
  return (
    <Screen id="payments">
      <Head eyebrow="Milestone payments" title="Pay for progress, in order, in fixed amounts" text="Milestones are completed one at a time. The next one opens only when the previous is paid." />
      <div className="grid pay-grid">
        <div className="stack">
          {MILESTONES.map((m, i) => (
            <div key={m.t} className={`card ms-card ${m.cls}`}>
              <div className="row between">
                <h3>{i + 1}. {m.t}</h3>
                <div className="row gap"><strong>{m.a}</strong><span className={`badge ${m.cls === 'done' ? 'approved' : m.cls === 'now' ? 'active' : ''}`}>{m.s}</span></div>
              </div>
              <p className="muted small">{m.d}</p>
              <ProgressBar value={m.pct} tone={m.pct === 100 ? 'good' : ''} label={`${m.t} completion`} />
            </div>
          ))}
        </div>
        <div className="card stack">
          <h3>How the money moves</h3>
          <ul className="steps-info">
            <li><span>1</span><div><strong>Amounts are signed</strong><p className="muted small">Each milestone amount is part of the agreement both sides sign.</p></div></li>
            <li><span>2</span><div><strong>Work is scored</strong><p className="muted small">The AI check produces a percentage with reasons for every criterion.</p></div></li>
            <li><span>3</span><div><strong>Fixed rules decide</strong><p className="muted small">At or above the threshold, release is automatic. Below it, the client decides.</p></div></li>
            <li><span>4</span><div><strong>PayPal pays out</strong><p className="muted small">Sandbox payout to the contractor's PayPal email, or a clearly labelled simulation.</p></div></li>
          </ul>
          <p className="small muted">This is a hackathon prototype. It is not escrow, and a sandbox payment is not real money.</p>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- 7. trust ---------- */
const TRUST = [
  { icon: Fingerprint, title: 'Content fingerprint', text: 'A SHA-256 hash of the signed terms. Change one word or one dollar and verification fails.' },
  { icon: ShieldCheck, title: 'Sealed signatures', text: 'Each signature is bound to the signer, role, time, mark and fingerprint with a server-side secret.' },
  { icon: Lock, title: 'Password re-check', text: 'Signing needs your password again, plus explicit consent that this mark is your signature.' },
  { icon: History, title: 'Audit trail', text: 'Every lock, signature, upload, AI score and payment is written to a timeline both sides can read.' },
  { icon: Eye, title: 'Admin oversight', text: 'Administrators get a read-only panel with each project as a step-by-step tracker, plus signature verification.' },
  { icon: FileSearch, title: 'Safe uploads', text: 'Size limits, blocked executable types and download-only delivery with no inline execution.' },
];

function Trust() {
  return (
    <Screen id="trust" tone="dark">
      <Head eyebrow="Trust and oversight" title="A record you can verify, not just read" text="Everything that happens is recorded, sealed where it matters, and visible to an administrator step by step." />
      <div className="grid feat">
        {TRUST.map(({ icon: Icon, title, text }) => (
          <article key={title} className="trust-card">
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <code className="hash-demo">sha256: 9f2c7a41b0e5d8c3...  seal: valid for version 2</code>
    </Screen>
  );
}

/* ---------- 8. faq ---------- */
const FAQ = [
  ['Do both people really need an account?', 'Yes. The client and the contractor each register. The creator invites the other person by email, and they see the agreement as soon as they sign up with that address.'],
  ['What exactly does the AI decide?', 'The AI judges each acceptance criterion from the note, link and readable files. Fixed server rules turn that into a percentage and a release decision. The amount is always the signed one.'],
  ['What if the AI is wrong?', 'Below the threshold, payment is held and the client can override and pay or request changes. The contractor can resubmit improved work at any time.'],
  ['Is this real money?', 'No. Payments use the PayPal sandbox when credentials are configured, otherwise they are simulated and labelled. This is a prototype, not escrow or a legal service.'],
  ['Can terms change after we sign?', 'Not silently. Reopening creates a new version and clears signatures, so both sides must sign the new version.'],
  ['What can the admin see?', 'Accounts, every agreement, its step-by-step status, AI scores, files, signature verification and the audit trail. The admin panel is read-only.'],
];

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <Screen id="faq" tone="alt">
      <Head eyebrow="Questions" title="Straight answers" text="Short, honest answers about how the prototype behaves." />
      <div className="faq">
        {FAQ.map(([q, a], i) => (
          <div key={q} className={`card faq-item ${open === i ? 'open' : ''}`}>
            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
              <span>{q}</span><ChevronDown size={18} />
            </button>
            {open === i && <p className="muted">{a}</p>}
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ---------- 9. cta ---------- */
function Cta() {
  return (
    <Screen id="start" tone="dark cta-screen">
      <div className="cta stack">
        <BadgeDollarSign size={40} />
        <h2>Start your first agreement</h2>
        <p className="lead">Create an account, invite the other side, and have a signed scope with milestone payments in minutes.</p>
        <div className="row gap center-row">
          <Link to="/register" className="btn accent lg">Create your account <ArrowRight size={18} /></Link>
          <Link to="/login" className="btn ghost-light lg">Sign in</Link>
        </div>
        <p className="small cta-note"><ScrollText size={14} /> Hackathon prototype: sandbox payments only.</p>
      </div>
    </Screen>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      <Hero />
      <How />
      <Features />
      <Roles />
      <AiCheck />
      <Payments />
      <Trust />
      <Faq />
      <Cta />
    </div>
  );
}
