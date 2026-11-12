import { Router } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { Agreement } from '../models/Agreement.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { processSteps, verifyAgreement } from '../lib/verify.js';

const router = Router();

router.use(requireAuth, (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrators only' }),
);

const summary = (a) => {
  const j = a.toJSON();
  const steps = processSteps(a);
  const current = steps.find((s) => s.state === 'current');
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    version: j.version,
    client: j.client?.email,
    contractor: j.contractor?.email,
    totalCents: j.totalCents,
    paidCents: j.paidCents,
    progressPct: j.progressPct,
    currentStep: current?.label ?? 'Finished',
    stepsDone: steps.filter((s) => s.done).length,
    stepsTotal: steps.length,
    held: a.milestones.some((m) => m.status === 'AI_HOLD'),
    files: j.files.length,
    updatedAt: j.updatedAt,
    createdAt: j.createdAt,
  };
};

router.get('/stats', async (_req, res) => {
  const [users, agreements] = await Promise.all([User.countDocuments(), Agreement.find().select('-signatures.mark')]);
  const byStatus = {};
  let value = 0, paid = 0, pctSum = 0, pctN = 0, holds = 0, files = 0, aiMode = 0, heuristicMode = 0, signed = 0;
  for (const a of agreements) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    files += a.files.length;
    signed += a.signatures.length;
    for (const m of a.milestones) {
      value += m.amountCents;
      paid += m.payment?.amountCents || 0;
      if (m.status === 'AI_HOLD') holds += 1;
      if (m.assessment) {
        pctSum += m.assessment.percent;
        pctN += 1;
        if (m.assessment.mode === 'ai') aiMode += 1; else heuristicMode += 1;
      }
    }
  }
  const recent = agreements
    .flatMap((a) => a.events.map((e) => ({ agreementId: String(a._id), title: a.title, type: e.type, detail: e.detail, at: e.at })))
    .sort((x, y) => new Date(y.at) - new Date(x.at))
    .slice(0, 25);
  res.json({
    users,
    agreements: agreements.length,
    byStatus,
    valueCents: value,
    paidCents: paid,
    avgAiPercent: pctN ? Math.round(pctSum / pctN) : null,
    aiChecks: { total: pctN, ai: aiMode, heuristic: heuristicMode },
    holds,
    files,
    signatures: signed,
    recent,
  });
});

router.get('/agreements', async (_req, res) => {
  const list = await Agreement.find().sort({ updatedAt: -1 }).select('-signatures.mark');
  res.json({ agreements: list.map(summary) });
});

router.get('/agreements/:id', async (req, res) => {
  const a = await Agreement.findById(req.params.id);
  if (!a) return res.status(404).json({ error: 'Agreement not found' });
  const [client, contractor] = await Promise.all([
    a.client?.user ? User.findById(a.client.user).select('name email createdAt') : null,
    a.contractor?.user ? User.findById(a.contractor.user).select('name email createdAt') : null,
  ]);
  res.json({ agreement: a.toJSON(), steps: processSteps(a), verify: verifyAgreement(a), client, contractor });
});

router.get('/agreements/:id/files/:fileId', async (req, res) => {
  const a = await Agreement.findById(req.params.id);
  const f = a?.files.id(req.params.fileId);
  if (!f || !existsSync(f.path)) return res.status(404).json({ error: 'File not found' });
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(f.path).pipe(res);
});

router.get('/users', async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  const agreements = await Agreement.find().select('client contractor status');
  const rows = users.map((u) => {
    const mine = agreements.filter((a) => a.client?.email === u.email || a.contractor?.email === u.email);
    return {
      id: String(u._id),
      name: u.name,
      email: u.email,
      role: u.role,
      paypalEmail: u.paypalEmail || null,
      createdAt: u.createdAt,
      agreements: mine.length,
      asClient: mine.filter((a) => a.client?.email === u.email).length,
      asContractor: mine.filter((a) => a.contractor?.email === u.email).length,
    };
  });
  res.json({ users: rows });
});

export default router;
