import { useEffect, useState } from 'react';
import { UserPlus, PenLine, Upload, Bot, Wallet, Check } from 'lucide-react';
import './how.css';

const STEPS = [
  { icon: UserPlus, title: 'Both sides create an account', text: 'Client and contractor sign up, then agree the scope and fixed-price milestones.' },
  { icon: PenLine, title: 'Sign the same version', text: 'The agreement is locked and fingerprinted. Each side signs with a tamper-evident seal.' },
  { icon: Upload, title: 'Upload the project', text: 'Briefs go in from either side. The contractor uploads the finished work for each milestone.' },
  { icon: Bot, title: 'AI checks it against the terms', text: 'Every acceptance criterion is scored and shown as a completion bar.' },
  { icon: Wallet, title: 'Pay with PayPal', text: 'At the release threshold the signed amount is paid. Below it, payment is held for the client.' },
];

const Sk = ({ w = '100%', h = 10, delay = 0 }) => (
  <div className="sk" style={{ width: w, height: h, animationDelay: `${delay}ms` }} />
);

function Scene({ step }) {
  if (step === 0)
    return (
      <div className="scene">
        <div className="row gap sk-people">
          <div className="sk-avatar sk" /> <Sk w="90px" /> <span className="sk-link" /> <div className="sk-avatar sk" /> <Sk w="90px" />
        </div>
        <Sk w="60%" h={16} />
        {[0, 1, 2].map((i) => <Sk key={i} w={`${92 - i * 14}%`} delay={i * 150} />)}
        <div className="sk-ms">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk-ms-row"><Sk w="50%" delay={i * 200} /><Sk w="50px" delay={i * 200} /></div>
          ))}
        </div>
      </div>
    );
  if (step === 1)
    return (
      <div className="scene">
        <Sk w="45%" h={14} />
        <Sk />
        <Sk w="85%" />
        <div className="sig-area">
          <svg viewBox="0 0 220 70" width="220" height="70" aria-hidden="true">
            <path className="sig-stroke" d="M8 48 C30 6 44 6 40 38 C38 60 60 20 74 30 C88 42 96 14 112 26 C126 36 134 44 160 22 C176 8 190 40 212 26" />
          </svg>
          <span className="seal"><Check size={14} /> Sealed</span>
        </div>
      </div>
    );
  if (step === 2)
    return (
      <div className="scene">
        {['project-brief.pdf', 'final-build.zip'].map((n, i) => (
          <div key={n} className="sk-file" style={{ animationDelay: `${i * 350}ms` }}>
            <div className="sk sk-file-icon" />
            <div className="grow">
              <span className="sk-name">{n}</span>
              <div className="bar"><i style={{ animationDelay: `${i * 350}ms` }} /></div>
            </div>
          </div>
        ))}
        <Sk w="70%" delay={300} />
        <Sk w="50%" delay={450} />
      </div>
    );
  if (step === 3)
    return (
      <div className="scene">
        <div className="row between"><strong className="small">Completion against terms</strong><span className="count-up" /></div>
        <div className="progress-track"><div className="progress-fill good anim-fill" /></div>
        {['Login works', 'Chatbot answers FAQs', 'Deployed and live'].map((t, i) => (
          <div key={t} className="crit" style={{ '--d': `${600 + i * 650}ms` }}>
            <span className="crit-sk"><Sk w="70%" delay={i * 120} /></span>
            <span className="crit-real"><Check size={14} /> {t}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="scene center-scene">
      <div className="pay-card">
        <div className="pay-badge"><Wallet size={22} /></div>
        <Sk w="120px" h={12} />
        <Sk w="70px" h={12} delay={150} />
        <div className="pay-amt">$110.00</div>
        <div className="pay-done"><Check size={16} /> Payment released</div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4800);
    return () => clearInterval(t);
  }, [paused]);

  return (
    <div className="how" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol className="how-steps">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title}>
            <button type="button" className={i === step ? 'active' : i < step ? 'done' : ''} onClick={() => setStep(i)} aria-current={i === step}>
              <span className="how-ico"><Icon size={18} /></span>
              <span>
                <strong>{title}</strong>
                {i === step && <small>{text}</small>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="how-screen" aria-live="polite">
        <div className="how-chrome"><i /><i /><i /><span>Step {step + 1} of {STEPS.length}</span></div>
        <Scene key={step} step={step} />
        <div className="how-timer"><div key={`${step}-${paused}`} className={paused ? 'paused' : ''} /></div>
      </div>
    </div>
  );
}
