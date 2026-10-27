// All configuration comes from environment variables (Vercel project settings / local .env). Nothing secret is hard-coded.
export const env = (k, d = '') => (process.env[k] ?? d);

export function config() {
  const prod = env('VERCEL_ENV') === 'production' || env('NODE_ENV') === 'production';
  const storeKind = env('STORE') || (env('GOOGLE_SHEET_ID') ? 'sheets' : 'memory');
  return {
    prod,
    appEnv: env('APP_ENV') || (prod ? 'production' : 'development'),
    storeKind,
    sheetId: env('GOOGLE_SHEET_ID'),
    clientEmail: env('GOOGLE_CLIENT_EMAIL'),
    privateKey: env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    sessionSecret: env('SESSION_SECRET'),
    cookieName: 'cure_session',
    defaultSessionMinutes: Number(env('SESSION_MINUTES', '60')),
    allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

// Fail closed: refuse to run with an unsafe configuration instead of silently degrading.
export function assertConfig(c = config()) {
  if (!c.sessionSecret || c.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  if (c.prod && c.storeKind === 'memory') throw new Error('STORE=memory is not allowed in production');
  if (c.storeKind === 'sheets' && (!c.sheetId || !c.clientEmail || !c.privateKey)) {
    throw new Error('GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are required for the Google Sheets store');
  }
}
