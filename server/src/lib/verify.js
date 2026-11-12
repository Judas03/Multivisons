import { agreementContentHash, safeEqualHex, sha256, signatureSeal } from './crypto.js';

export function verifyAgreement(a) {
  const currentHash = a.contentHash ? agreementContentHash(a) : null;
  const signatures = a.signatures.map((s) => {
    const expected = signatureSeal({
      agreementId: String(a._id),
      contentHash: s.contentHash,
      userId: String(s.user),
      role: s.role,
      signedAt: s.signedAt,
      markHash: s.markHash,
    });
    return {
      role: s.role,
      name: s.name,
      signedAt: s.signedAt,
      sealValid: safeEqualHex(expected, s.seal),
      markIntact: sha256(s.mark) === s.markHash,
      matchesCurrentContent: s.contentHash === currentHash,
    };
  });
  return {
    contentHash: a.contentHash ?? null,
    contentIntact: currentHash === (a.contentHash ?? null),
    version: a.version,
    signatures,
    allValid: signatures.length > 0 && signatures.every((s) => s.sealValid && s.markIntact && s.matchesCurrentContent),
  };
}

/** Ordered process steps of one agreement with done / current / pending state, for the admin tracker. */
export function processSteps(a) {
  const sig = (role) => a.signatures.find((s) => s.role === role);
  const ev = (type) => [...a.events].reverse().find((e) => e.type === type);
  const steps = [
    { key: 'drafted', label: 'Draft created', done: true, at: a.createdAt },
    { key: 'accounts', label: 'Both parties have accounts', done: Boolean(a.client?.user && a.contractor?.user), detail: `${a.client?.email} / ${a.contractor?.email}` },
    { key: 'locked', label: 'Version locked and fingerprinted', done: a.status !== 'DRAFT', at: a.lockedAt, detail: a.contentHash ? `hash ${a.contentHash.slice(0, 12)}` : '' },
    { key: 'sign-client', label: 'Client signed', done: Boolean(sig('client')), at: sig('client')?.signedAt },
    { key: 'sign-contractor', label: 'Contractor signed', done: Boolean(sig('contractor')), at: sig('contractor')?.signedAt },
    { key: 'active', label: 'Agreement active', done: ['ACTIVE', 'COMPLETED'].includes(a.status), at: ev('activated')?.at },
  ];
  a.milestones.forEach((m, i) => {
    const n = i + 1;
    steps.push(
      { key: `m${i}-sub`, label: `Milestone ${n}: work submitted`, done: m.evidence.length > 0, at: m.evidence.at(-1)?.at, detail: m.title },
      {
        key: `m${i}-ai`,
        label: `Milestone ${n}: AI completion check`,
        done: Boolean(m.assessment),
        at: m.assessment?.at,
        detail: m.assessment ? `${m.assessment.percent}% (${m.assessment.mode}), ${m.assessment.decision}` : '',
        warn: m.assessment?.decision === 'HOLD' && m.status !== 'APPROVED',
      },
      { key: `m${i}-pay`, label: `Milestone ${n}: payment released`, done: m.status === 'APPROVED', at: m.payment?.at, detail: m.payment ? `${m.payment.mode}, ${m.approvedBy}` : '' },
    );
  });
  steps.push({ key: 'completed', label: 'Project completed', done: a.status === 'COMPLETED' });
  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : i === firstOpen ? 'current' : 'pending' }));
}
