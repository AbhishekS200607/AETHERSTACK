'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const nodemailer = require('nodemailer');
const he         = require('he');
const { createClient } = require('@supabase/supabase-js');
const path       = require('path');

const marketingRouter = require('./marketing');

const app = express();

// ── Supabase (anon key for existing public routes) ───────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ════════════════════════════════════════════════════════════
//  SECURITY MIDDLEWARE
// ════════════════════════════════════════════════════════════

// Helmet sets 14 secure HTTP headers in one call:
// X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-hashes'", 'cdn.tailwindcss.com', 'fonts.googleapis.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com', 'r2cdn.perplexity.ai', 'data:'],
      imgSrc:      ["'self'", 'data:', 'api.microlink.io', 'https:'],
      connectSrc:  ["'self'", 'https:']
    }
  }
}));

// ── CORS — restrict to your own domain in production ─────────
//
//  IMPORTANT: Replace the origin list with your actual deployed
//  domain(s). Using '*' would allow any site to call your API.
//
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin(origin, callback) {
    // Allow server-to-server calls (no origin header) and listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '16kb' }));   // prevent oversized payloads
app.use(express.static(path.join(__dirname, '../public')));

// ════════════════════════════════════════════════════════════
//  NODEMAILER (existing contact form)
// ════════════════════════════════════════════════════════════
const transporter = nodemailer.createTransport({
  service: 'gmail',
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ════════════════════════════════════════════════════════════
//  EXISTING ROUTES
// ════════════════════════════════════════════════════════════

async function readProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('id', { ascending: false });
  if (error) console.error('Supabase error:', error);
  return data || [];
}

async function readSubmissions() {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('id', { ascending: false });
  if (error) console.error('Supabase error:', error);
  return data || [];
}

async function saveSubmission(data) {
  const { error } = await supabase.from('submissions').insert([{
    id:           Date.now(),
    name:         data.name,
    email:        data.email,
    projectType:  data.projectType || null,
    budget:       data.budget || null,
    message:      data.message,
    referralCode: data.referralCode || null
  }]);
  if (error) console.error('Supabase error:', error.message);
}

// ── POST /api/contact ────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, email, projectType, budget, message, referralCode } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  await saveSubmission({ name, email, projectType, budget, message, referralCode });

  // ── If a referral code was provided, increment that marketer's lead count ──
  // Uses the service-role client from marketing.js indirectly via a fresh client here.
  if (referralCode && /^[A-Z0-9]{4}$/i.test(referralCode)) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbService = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      // Fetch current lead count then increment (Supabase JS v2 has no atomic increment via RPC easily)
      const { data: mktr } = await sbService
        .from('marketers')
        .select('id, total_leads')
        .eq('referral_code', referralCode.toUpperCase())
        .maybeSingle();
      if (mktr) {
        await sbService
          .from('marketers')
          .update({ total_leads: mktr.total_leads + 1 })
          .eq('id', mktr.id);
        if (process.env.NODE_ENV !== 'production') console.log(`[referral] Lead credited to marketer ${mktr.id} via code ${referralCode}`);
      }
    } catch (e) {
      // Non-fatal — don't block the contact form submission
      console.error('[referral] Failed to credit lead:', e.message);
    }
  }

  try {
    await transporter.sendMail({
      from:    `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to:      process.env.EMAIL_USER,
      subject: `New Proposal from ${he.encode(name)}`,
      html: `
        <div style="font-family:sans-serif;padding:20px;color:#333;">
          <h2 style="color:#ff6b4a;">New Contact Submission</h2>
          <hr style="border:0;border-top:1px solid #eee;"/>
          <p><b>Name:</b> ${he.encode(name)}</p>
          <p><b>Email:</b> ${he.encode(email)}</p>
          <p><b>Project Type:</b> ${he.encode(projectType || '')}</p>
          <p><b>Budget:</b> ${he.encode(budget || '')}</p>
          ${referralCode ? `<p><b>Referral Code:</b> <span style="background:#fff3f0;padding:2px 8px;border-radius:4px;font-weight:bold;color:#ff6b4a">${he.encode(referralCode.toUpperCase())}</span></p>` : ''}
          <p style="background:#f9f9f9;padding:15px;border-radius:8px;">
            <b>Message:</b><br/>${he.encode(message)}
          </p>
        </div>
      `
    });
  } catch (e) {
    console.error('EMAIL FAILED:', e.message);
  }

  res.json({ success: true, message: 'Proposal received!' });
});

// ── Admin auth middleware ────────────────────────────────────
function adminAuth(req, res, next) {
  // FIX: read secret from Authorization header, not query string
  // (query params appear in server logs and browser history)
  const header = req.headers['x-admin-secret'] || req.body?.secret;
  if (header !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/submissions', adminAuth, async (req, res) => {
  res.json(await readSubmissions());
});

app.get('/api/projects', async (req, res) => res.json(await readProjects()));

app.post('/api/projects', adminAuth, async (req, res) => {
  const { title, description, tags, imageUrl, link } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required.' });
  }
  const { data, error } = await supabase.from('projects').insert([
    { id: Date.now(), title, description, tags: tags || [], imageUrl: imageUrl || '', link: link || '' }
  ]).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

app.put('/api/projects/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('projects')
    .update({ ...req.body, id: Number(req.params.id) })
    .eq('id', Number(req.params.id))
    .select();
  if (error || !data?.length) return res.status(404).json({ error: 'Not found.' });
  res.json(data[0]);
});

app.delete('/api/projects/:id', adminAuth, async (req, res) => {
  await supabase.from('projects').delete().eq('id', Number(req.params.id));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  MARKETING PORTAL ROUTES  (mounted at /api/marketing)
// ════════════════════════════════════════════════════════════
app.use('/api/marketing', marketingRouter);

// ── 404 handler — must be last ───────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[unhandled]', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
