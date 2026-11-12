import { fileURLToPath } from 'node:url';

const prod = process.env.NODE_ENV === 'production';

function secret(name) {
  const v = process.env[name];
  if (v) return v;
  if (prod) throw new Error(`${name} must be set in production`);
  return `dev-only-${name.toLowerCase()}`;
}

export const config = {
  prod,
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/multivisons',
  jwtSecret: secret('JWT_SECRET'),
  signatureSecret: secret('SIGNATURE_SECRET'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};

Object.assign(config, {
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  releaseThreshold: Number(process.env.RELEASE_THRESHOLD) || 85,
  autoRelease: process.env.AUTO_RELEASE || 'ai',
  paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
  paypalSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  uploadDir: process.env.UPLOAD_DIR || fileURLToPath(new URL('../uploads', import.meta.url)),
});
