import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync, createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { assessSubmission } from '../lib/assess.js';
import { releasePayment } from '../lib/payments.js';
import { z } from 'zod';
import { Agreement } from '../models/Agreement.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { agreementContentHash, sha256, signatureSeal } from '../lib/crypto.js';
import { verifyAgreement } from '../lib/verify.js';

const router = Router();

/* ---------- helpers ---------- */

const email = z.string().trim().toLowerCase().email();

const milestoneInput = z.object({
  title: z.string().trim().min(1).max(200),
  criteria: z.string().max(4000).default(''),
  amountCents: z.number().int().min(1).max(100_000_000),
});

const draftInput = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(4000).default(''),
  terms: z.string().max(20000).default(''),
  myRole: z.enum(['client', 'contractor']),
  counterpartyEmail: email,
  milestones: z.array(milestoneInput).max(12).default([]),
});

function roleOf(a, user) {
  if (a.client?.email === user.email || String(a.client?.user) === String(user._id)) return 'client';
  if (a.contractor?.email === user.email || String(a.contractor?.user) === String(user._id)) return 'contractor';
  return null;
}

async function linkUsers(a) {
  for (const key of ['client', 'contractor']) {
    if (a[key]?.email && !a[key].user) {
      const u = await User.findOne({ email: a[key].email }).select('_id');
      if (u) a[key].user = u._id;
    }
  }
}

function log(a, user, type, detail = '') {
  a.events.push({ type, by: user._id, detail });
}

async function load(req, res, next) {
  const a = await Agreement.findById(req.params.id);
  const role = a && roleOf(a, req.user);
  if (!a || !role) return res.status(404).json({ error: 'Agreement not found' });
  req.agreement = a;
  req.role = role;
  next();
}

/** Public-safe view: includes signer names/roles but not other parties' raw drawn marks to non-parties (all callers are parties). */
function view(a, role) {
  const json = a.toJSON();
  json.myRole = role;
  return json;
}

function assertDraft(a, res) {
  if (a.status !== 'DRAFT') {
    res.status(409).json({ error: 'This agreement is locked for signing. Reopen it to make changes (signatures will be cleared).' });
    return false;
  }
  return true;
}

/* ---------- list / create / read ---------- */

router.use(requireAuth);

router.get('/', async (req, res) => {
  const list = await Agreement.find({
    $or: [{ 'client.email': req.user.email }, { 'contractor.email': req.user.email }, { 'client.user': req.user._id }, { 'contractor.user': req.user._id }],
  })
    .sort({ updatedAt: -1 })
    .select('-signatures.mark -events');
  res.json({ agreements: list.map((a) => view(a, roleOf(a, req.user))) });
});

router.post('/', async (req, res) => {
  const b = draftInput.parse(req.body);
  if (b.counterpartyEmail === req.user.email) return res.status(400).json({ error: 'The other party must be a different person' });
  const me = { email: req.user.email, user: req.user._id };
  const them = { email: b.counterpartyEmail };
  const a = new Agreement({
    title: b.title,
    summary: b.summary,
    terms: b.terms,
    milestones: b.milestones,
    createdBy: req.user._id,
    client: b.myRole === 'client' ? me : them,
    contractor: b.myRole === 'contractor' ? me : them,
  });
  await linkUsers(a);
  log(a, req.user, 'created', `Draft created as ${b.myRole}`);
  await a.save();
  res.status(201).json({ agreement: view(a, b.myRole) });
});

router.get('/:id', load, (req, res) => res.json({ agreement: view(req.agreement, req.role) }));

router.put('/:id', load, async (req, res) => {
  const a = req.agreement;
  if (!assertDraft(a, res)) return;
  const b = draftInput.omit({ myRole: true }).partial().parse(req.body);
  for (const k of ['title', 'summary', 'terms', 'milestones']) if (b[k] !== undefined) a[k] = b[k];
  if (b.counterpartyEmail) {
    if (b.counterpartyEmail === req.user.email) return res.status(400).json({ error: 'The other party must be a different person' });
    const other = req.role === 'client' ? 'contractor' : 'client';
    a[other] = { email: b.counterpartyEmail };
    await linkUsers(a);
  }
  log(a, req.user, 'edited');
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

router.delete('/:id', load, async (req, res) => {
  if (!req.agreement.createdBy.equals(req.user._id) || req.agreement.status !== 'DRAFT') {
    return res.status(409).json({ error: 'Only the creator can delete an unsigned draft' });
  }
  await req.agreement.deleteOne();
  res.json({ ok: true });
});

/* ---------- lock, reopen ---------- */

router.post('/:id/send', load, async (req, res) => {
  const a = req.agreement;
  if (!assertDraft(a, res)) return;
  if (!a.milestones.length) return res.status(400).json({ error: 'Add at least one milestone before sending for signature' });
  if (!a.terms.trim() && !a.summary.trim()) return res.status(400).json({ error: 'Describe the scope or terms first' });
  a.status = 'AWAITING_SIGNATURES';
  a.lockedAt = new Date();
  a.contentHash = agreementContentHash(a);
  log(a, req.user, 'locked', `Version ${a.version} locked, hash ${a.contentHash.slice(0, 12)}`);
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

router.post('/:id/reopen', load, async (req, res) => {
  const a = req.agreement;
  if (a.status !== 'AWAITING_SIGNATURES') return res.status(409).json({ error: 'Only an agreement awaiting signatures can be reopened' });
  a.status = 'DRAFT';
  a.version += 1;
  a.signatures = [];
  a.contentHash = undefined;
  a.lockedAt = undefined;
  log(a, req.user, 'reopened', `Reopened as version ${a.version}; earlier signatures cleared`);
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

/* ---------- digital signature ---------- */

const signInput = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('draw'),
    mark: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
    password: z.string(),
    consent: z.literal(true),
  }),
  z.object({
    method: z.literal('type'),
    mark: z.string().trim().min(2).max(120),
    password: z.string(),
    consent: z.literal(true),
  }),
]);

router.post('/:id/sign', load, async (req, res) => {
  const a = req.agreement;
  if (a.status !== 'AWAITING_SIGNATURES') return res.status(409).json({ error: 'This agreement is not open for signing' });
  const b = signInput.parse(req.body);

  const me = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(b.password, me.passwordHash))) return res.status(401).json({ error: 'Password confirmation failed' });
  if (a.signatures.some((s) => s.role === req.role)) return res.status(409).json({ error: 'You have already signed this version' });

  // Defend against any tampering since lock time.
  if (agreementContentHash(a) !== a.contentHash) return res.status(409).json({ error: 'Agreement content no longer matches its locked hash' });

  const signedAt = new Date();
  const markHash = sha256(b.mark);
  a.signatures.push({
    user: req.user._id,
    role: req.role,
    name: req.user.name,
    method: b.method,
    mark: b.mark,
    markHash,
    contentHash: a.contentHash,
    signedAt,
    ip: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
    seal: signatureSeal({
      agreementId: String(a._id),
      contentHash: a.contentHash,
      userId: String(req.user._id),
      role: req.role,
      signedAt,
      markHash,
    }),
  });
  log(a, req.user, 'signed', `${req.user.name} signed as ${req.role}`);
  if (a.signatures.length === 2) {
    a.status = 'ACTIVE';
    log(a, req.user, 'activated', 'Both parties signed; work may begin');
  }
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

router.get('/:id/verify', load, (req, res) => res.json(verifyAgreement(req.agreement)));

/* ---------- project files (brief from either party, deliverables from the contractor) ---------- */

mkdirSync(config.uploadDir, { recursive: true });
const BLOCKED = /\.(exe|dll|bat|cmd|com|scr|msi|ps1|sh|vbs|jar|apk)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, f, cb) => cb(null, !BLOCKED.test(f.originalname)),
});

const TEXTY = /(^text\/)|json|xml|javascript|csv|markdown|html/i;
async function readable(f) {
  if (!(TEXTY.test(f.mimetype) || /\.(txt|md|json|csv|html?|css|jsx?|tsx?|py|java|sql|yml|yaml)$/i.test(f.originalname))) return '';
  try {
    return (await readFile(f.path, 'utf8')).slice(0, 20000);
  } catch {
    return '';
  }
}

const toFileDoc = (f, req, milestone) => ({
  name: path.basename(f.originalname).slice(0, 200),
  mime: f.mimetype,
  size: f.size,
  path: f.path,
  by: req.user._id,
  role: req.role,
  milestone,
});

router.post('/:id/files', load, upload.array('files', 5), async (req, res) => {
  const a = req.agreement;
  if (a.status === 'COMPLETED') return res.status(409).json({ error: 'This agreement is completed' });
  if (!req.files?.length) return res.status(400).json({ error: 'Choose at least one file (executables are not accepted, max 10 MB each)' });
  for (const f of req.files) a.files.push(toFileDoc(f, req));
  log(a, req.user, 'files', `${req.role} added ${req.files.length} project file(s)`);
  await a.save();
  res.status(201).json({ agreement: view(a, req.role) });
});

router.get('/:id/files/:fileId', load, (req, res) => {
  const f = req.agreement.files.id(req.params.fileId);
  if (!f || !existsSync(f.path)) return res.status(404).json({ error: 'File not found' });
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(f.path).pipe(res);
});

/* ---------- milestones ---------- */

const openMilestone = (a) => a.milestones.find((m) => m.status !== 'APPROVED');

async function approveAndPay(a, m, index, by, actor) {
  m.status = 'APPROVED';
  m.approvedAt = new Date();
  m.approvedBy = by;
  const payee = await User.findById(a.contractor.user).select('paypalEmail email');
  // Deterministic rule: payment amount is the signed, fixed milestone amount. Nothing else can set it.
  m.payment = await releasePayment({
    agreementId: String(a._id),
    milestoneIndex: index,
    amountCents: m.amountCents,
    payeeEmail: payee?.paypalEmail || payee?.email,
  });
  const label = m.payment.mode === 'paypal-sandbox' ? 'PayPal sandbox payout' : 'simulated sandbox payment';
  log(a, actor, 'approved', `"${m.title}" approved by ${by === 'ai' ? 'AI check' : 'client'}; ${label} ${m.payment.reference}`);
  if (a.milestones.every((x) => x.status === 'APPROVED')) {
    a.status = 'COMPLETED';
    log(a, actor, 'completed', 'All milestones approved');
  }
}

router.post('/:id/milestones/:index/submit', load, upload.array('files', 5), async (req, res) => {
  const a = req.agreement;
  if (a.status !== 'ACTIVE') return res.status(409).json({ error: 'Agreement is not active' });
  if (req.role !== 'contractor') return res.status(403).json({ error: 'Only the contractor submits project work' });
  const index = Number(req.params.index);
  const m = a.milestones[index];
  if (!m || m !== openMilestone(a)) return res.status(409).json({ error: 'Milestones are completed in order' });
  if (m.status === 'SUBMITTED') return res.status(409).json({ error: 'Already submitted; waiting for the client' });
  const b = z.object({ note: z.string().trim().min(1).max(4000), url: z.string().url().max(2000).optional().or(z.literal('').transform(() => undefined)) }).parse(req.body);

  const uploaded = req.files || [];
  const withText = [];
  for (const f of uploaded) {
    a.files.push(toFileDoc(f, req, index));
    withText.push({ name: f.originalname, mime: f.mimetype, size: f.size, text: await readable(f) });
  }
  m.evidence.push({ note: b.note, url: b.url, by: req.user._id });
  log(a, req.user, 'submitted', `Work submitted for "${m.title}" (${uploaded.length} file(s))`);

  const assessment = await assessSubmission({ agreement: a, milestone: m, note: b.note, url: b.url, files: withText });
  m.assessment = assessment;
  log(a, req.user, 'assessed', `AI check (${assessment.mode}): ${assessment.percent}% of criteria met, decision ${assessment.decision}`);

  if (assessment.decision === 'RELEASE') {
    await approveAndPay(a, m, index, 'ai', req.user);
  } else {
    m.status = assessment.decision === 'HOLD' ? 'AI_HOLD' : 'SUBMITTED';
  }
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

router.post('/:id/milestones/:index/review', load, async (req, res) => {
  const a = req.agreement;
  if (a.status !== 'ACTIVE') return res.status(409).json({ error: 'Agreement is not active' });
  if (req.role !== 'client') return res.status(403).json({ error: 'Only the client reviews and approves' });
  const index = Number(req.params.index);
  const m = a.milestones[index];
  if (!m || !['SUBMITTED', 'AI_HOLD'].includes(m.status)) return res.status(409).json({ error: 'Nothing is waiting for review on this milestone' });
  const b = z.object({ decision: z.enum(['approve', 'request_changes']), note: z.string().max(2000).default('') }).parse(req.body);

  m.reviewNote = b.note;
  if (b.decision === 'request_changes') {
    m.status = 'CHANGES_REQUESTED';
    log(a, req.user, 'changes_requested', `"${m.title}": ${b.note}`);
  } else {
    await approveAndPay(a, m, index, 'client', req.user);
  }
  await a.save();
  res.json({ agreement: view(a, req.role) });
});

export default router;
