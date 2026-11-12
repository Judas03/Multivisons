import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { COOKIE, issueSession, requireAuth } from '../middleware/auth.js';

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  paypalEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
});

router.post('/register', limiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (await User.exists({ email: body.email })) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const user = await User.create({
    name: body.name,
    email: body.email,
    paypalEmail: body.paypalEmail,
    role: config.adminEmails.includes(body.email) ? 'admin' : 'user',
    passwordHash: await bcrypt.hash(body.password, 12),
  });
  issueSession(res, user);
  res.status(201).json({ user });
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = z
    .object({ email: z.string().trim().toLowerCase(), password: z.string() })
    .parse(req.body);
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });
  if (config.adminEmails.includes(user.email) && user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
  }
  issueSession(res, user);
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
