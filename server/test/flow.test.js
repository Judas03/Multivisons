import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.AUTO_RELEASE = 'always';
process.env.ADMIN_EMAILS = 'root@example.com';
process.env.UPLOAD_DIR = new URL('../uploads-test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { createApp } = await import('../src/app.js');

let mongod, server, base;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
});

function agent() {
  let cookie = '';
  return async (method, url, body) => {
    const form = body instanceof FormData;
    const r = await fetch(base + url, {
      method,
      headers: form ? { cookie } : { 'content-type': 'application/json', cookie },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
}

test('agreement -> signatures -> milestone approval', async () => {
  const client = agent();
  const worker = agent();
  const PW = 'correct horse battery';

  assert.equal((await client('POST', '/auth/register', { name: 'Ada Client', email: 'ada@example.com', password: PW })).status, 201);
  assert.equal((await client('POST', '/auth/register', { name: 'Ada Client', email: 'ada@example.com', password: PW })).status, 409);

  let r = await client('POST', '/agreements', {
    title: 'Chatbot build',
    summary: 'FAQ chatbot',
    terms: 'Fixed price, two milestones.',
    myRole: 'client',
    counterpartyEmail: 'bo@example.com',
    milestones: [
      { title: 'Prototype', criteria: 'Clickable flow', amountCents: 4000 },
      { title: 'Launch', criteria: 'Deployed bot', amountCents: 11000 },
    ],
  });
  assert.equal(r.status, 201);
  const id = r.data.agreement.id;
  assert.equal(r.data.agreement.totalCents, 15000);

  // The counterparty registers after being invited and can still see the agreement.
  await worker('POST', '/auth/register', { name: 'Bo Worker', email: 'bo@example.com', password: PW });
  assert.equal((await worker('GET', `/agreements/${id}`)).data.agreement.myRole, 'contractor');

  // Strangers cannot see it.
  const stranger = agent();
  await stranger('POST', '/auth/register', { name: 'Eve', email: 'eve@example.com', password: PW });
  assert.equal((await stranger('GET', `/agreements/${id}`)).status, 404);

  // Cannot sign before lock.
  const sig = { method: 'type', mark: 'Ada Client', password: PW, consent: true };
  assert.equal((await client('POST', `/agreements/${id}/sign`, sig)).status, 409);

  assert.equal((await client('POST', `/agreements/${id}/send`)).status, 200);
  assert.equal((await client('PUT', `/agreements/${id}`, { title: 'Changed' })).status, 409);

  // Wrong password is rejected.
  assert.equal((await client('POST', `/agreements/${id}/sign`, { ...sig, password: 'nope-nope-nope' })).status, 401);

  assert.equal((await client('POST', `/agreements/${id}/sign`, sig)).status, 200);
  assert.equal((await client('POST', `/agreements/${id}/sign`, sig)).status, 409);

  const png = 'data:image/png;base64,iVBORw0KGgo=';
  r = await worker('POST', `/agreements/${id}/sign`, { method: 'draw', mark: png, password: PW, consent: true });
  assert.equal(r.data.agreement.status, 'ACTIVE');

  r = await client('GET', `/agreements/${id}/verify`);
  assert.equal(r.data.allValid, true);

  // Milestones: ordered, role-restricted, amount fixed by the signed terms.
  assert.equal((await worker('POST', `/agreements/${id}/milestones/1/submit`, { note: 'early' })).status, 409);
  assert.equal((await client('POST', `/agreements/${id}/milestones/0/submit`, { note: 'x' })).status, 403);
  // No file: capped at 40%, so the AI holds payment and the client must decide.
  r = await worker('POST', `/agreements/${id}/milestones/0/submit`, { note: 'Done', url: 'https://example.com/demo' });
  assert.equal(r.status, 200);
  assert.equal(r.data.agreement.milestones[0].status, 'AI_HOLD');
  assert.ok(r.data.agreement.milestones[0].assessment.percent <= 40);
  assert.equal((await worker('POST', `/agreements/${id}/milestones/0/review`, { decision: 'approve' })).status, 403);
  r = await client('POST', `/agreements/${id}/milestones/0/review`, { decision: 'approve' });
  assert.equal(r.data.agreement.milestones[0].payment.amountCents, 4000);
  assert.equal(r.data.agreement.milestones[0].approvedBy, 'client');

  // Contractor uploads the project; criteria are covered, so the AI releases payment itself.
  const form = new FormData();
  form.set('note', 'Deployed the bot to production');
  form.set('files', new Blob(['The bot is deployed and live.']), 'bot-report.txt');
  r = await worker('POST', `/agreements/${id}/milestones/1/submit`, form);
  assert.equal(r.status, 200);
  assert.equal(r.data.agreement.milestones[1].approvedBy, 'ai');
  assert.equal(r.data.agreement.milestones[1].assessment.percent, 100);
  assert.equal(r.data.agreement.status, 'COMPLETED');
  assert.equal(r.data.agreement.progressPct, 100);
  assert.equal(r.data.agreement.files.length, 1);

  // Tampering with stored terms is detected.
  await mongoose.model('Agreement').updateOne({ _id: id }, { $set: { 'milestones.0.amountCents': 1 } });
  r = await client('GET', `/agreements/${id}/verify`);
  assert.equal(r.data.contentIntact, false);
  assert.equal(r.data.allValid, false);
});

test('admin panel is admin-only and shows steps', async () => {
  const PW = 'correct horse battery';
  const admin = agent();
  const user = agent();
  process.env.ADMIN_EMAILS; // configured via config at import time
  await user('POST', '/auth/register', { name: 'Plain', email: 'plain@example.com', password: PW });
  assert.equal((await user('GET', '/admin/stats')).status, 403);
  await admin('POST', '/auth/register', { name: 'Root', email: 'root@example.com', password: PW });
  const stats = await admin('GET', '/admin/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.data.agreements >= 1);
  const list = await admin('GET', '/admin/agreements');
  const id = list.data.agreements[0].id;
  const d = await admin('GET', `/admin/agreements/${id}`);
  assert.ok(d.data.steps.length > 6);
  assert.ok(d.data.steps.some((s) => s.state === 'done'));
});
