import mongoose from 'mongoose';

const { Schema } = mongoose;

const party = new Schema(
  { email: { type: String, lowercase: true, trim: true }, user: { type: Schema.Types.ObjectId, ref: 'User' } },
  { _id: false },
);

const evidence = new Schema(
  {
    note: { type: String, maxlength: 4000 },
    url: { type: String, maxlength: 2000 },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const milestone = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  criteria: { type: String, default: '', maxlength: 4000 },
  amountCents: { type: Number, required: true, min: 1, validate: Number.isInteger },
  // Delivery state is mutable and deliberately NOT part of the signed content hash.
  status: { type: String, enum: ['PENDING', 'SUBMITTED', 'AI_HOLD', 'CHANGES_REQUESTED', 'APPROVED'], default: 'PENDING' },
  evidence: [evidence],
  reviewNote: { type: String, default: '' },
  assessment: {
    percent: Number,
    decision: { type: String, enum: ['RELEASE', 'RECOMMEND_RELEASE', 'HOLD'] },
    mode: { type: String, enum: ['ai', 'heuristic'] },
    threshold: Number,
    summary: String,
    criteria: [{ _id: false, criterion: String, met: Boolean, note: String }],
    gaps: [String],
    at: Date,
  },
  approvedBy: { type: String, enum: ['ai', 'client'] },
  approvedAt: Date,
  payment: { mode: String, reference: String, amountCents: Number, at: Date },
});

const file = new Schema({
  name: { type: String, required: true },
  mime: String,
  size: Number,
  path: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  role: String,
  milestone: Number, // index when it is delivery evidence; undefined for project brief files
  at: { type: Date, default: Date.now },
});

const signature = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['client', 'contractor'], required: true },
    name: { type: String, required: true },
    method: { type: String, enum: ['draw', 'type'], required: true },
    mark: { type: String, required: true }, // PNG data URL (draw) or typed name (type)
    markHash: { type: String, required: true },
    contentHash: { type: String, required: true },
    signedAt: { type: Date, required: true },
    ip: String,
    userAgent: String,
    seal: { type: String, required: true },
  },
  { _id: false },
);

const event = new Schema(
  { type: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, detail: String, at: { type: Date, default: Date.now } },
  { _id: false },
);

const agreementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, default: '', maxlength: 4000 },
    terms: { type: String, default: '', maxlength: 20000 },
    currency: { type: String, default: 'USD', enum: ['USD'] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    client: party,
    contractor: party,
    milestones: { type: [milestone], default: [] },
    status: { type: String, enum: ['DRAFT', 'AWAITING_SIGNATURES', 'ACTIVE', 'COMPLETED'], default: 'DRAFT' },
    version: { type: Number, default: 1 },
    contentHash: String,
    lockedAt: Date,
    signatures: { type: [signature], default: [] },
    events: { type: [event], default: [] },
    files: { type: [file], default: [] },
  },
  { timestamps: true },
);

agreementSchema.index({ 'client.email': 1 });
agreementSchema.index({ 'contractor.email': 1 });

agreementSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    const ms = ret.milestones || [];
    ret.totalCents = ms.reduce((s, m) => s + m.amountCents, 0);
    // Overall progress: approved milestones count fully; the open one counts by its latest AI score.
    const done = ms.reduce((s, m) => s + (m.status === 'APPROVED' ? m.amountCents : (m.amountCents * (m.assessment?.percent || 0)) / 100), 0);
    ret.progressPct = ret.totalCents ? Math.round((done / ret.totalCents) * 100) : 0;
    ret.paidCents = ms.reduce((s, m) => s + (m.payment?.amountCents || 0), 0);
    ret.files = (ret.files || []).map((f) => ({ id: String(f._id), name: f.name, mime: f.mime, size: f.size, role: f.role, milestone: f.milestone, at: f.at }));
    return ret;
  },
});

export const Agreement = mongoose.model('Agreement', agreementSchema);
