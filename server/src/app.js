require('dotenv').config();
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const { ping }    = require('./db/connection');
const escalation  = require('./jobs/escalation');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL, 'https://realconfort.co']
    : '*',
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } }));
app.use('/api',      rateLimit({ windowMs: 60 * 1000,      max: 200 }));

// ── Parsing ───────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api/credits',   require('./routes/credits'));
app.use('/api/promises',  require('./routes/promises'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/whatsapp',  require('./routes/whatsapp'));
app.use('/api/calls',     require('./routes/calls'));
app.use('/api/analytics', require('./routes/analytics'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Manual escalation trigger (dev only) ──────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/run-escalation', async (req, res) => {
    await escalation.runEscalation();
    res.json({ ok: true });
  });
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  await ping();
  escalation.start();
  app.listen(PORT, () => {
    console.log(`\n🐍  Cobra API running on port ${PORT}`);
    console.log(`    ENV: ${process.env.NODE_ENV}`);
    console.log(`    WA:  ${process.env.WA_TOKEN      ? '✅ live' : '🟡 mock'}`);
    console.log(`    Dapta: ${process.env.DAPTA_API_KEY ? '✅ live' : '🟡 mock'}`);
    console.log(`    Bold:  ${process.env.BOLD_SECRET_KEY ? '✅ live' : '🟡 mock'}`);
    console.log(`    Alegra: ${process.env.ALEGRA_TOKEN  ? '✅ live' : '🟡 mock'}\n`);
  });
}

boot().catch(err => {
  console.error('Boot failed:', err);
  process.exit(1);
});
