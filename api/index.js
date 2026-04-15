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

// ── POST /api/apply ────────────────────────────────────────
app.post('/api/apply', async (req, res) => {
  const { name, email, college, role, portfolio, message } = req.body;
  if (!name || !email || !college || !role || !message) {
    return res.status(400).json({ error: 'Name, email, college, role and message are required.' });
  }
  const { error } = await supabase.from('applications').insert([{
    id: Date.now(), name, email, college, role, portfolio: portfolio || null, message, status: 'new'
  }]);
  if (error) console.error('Supabase error:', error.message);

  // Notify admin
  try {
    await transporter.sendMail({
      from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `📋 New Application: ${he.encode(name)} — ${he.encode(role)}`,
      html: `
        <div style="font-family:sans-serif;padding:20px;color:#333">
          <h2 style="color:#ff6035">New Career Application</h2>
          <hr style="border:0;border-top:1px solid #eee"/>
          <p><b>Name:</b> ${he.encode(name)}</p>
          <p><b>Email:</b> ${he.encode(email)}</p>
          <p><b>College:</b> ${he.encode(college)}</p>
          <p><b>Role:</b> ${he.encode(role)}</p>
          ${portfolio ? `<p><b>Portfolio:</b> <a href="${he.encode(portfolio)}">${he.encode(portfolio)}</a></p>` : ''}
          <p style="background:#f9f9f9;padding:15px;border-radius:8px"><b>Why join:</b><br/>${he.encode(message)}</p>
        </div>`
    });
  } catch (e) { console.error('EMAIL FAILED:', e.message); }

  // Send confirmation to applicant
  try {
    const firstName = name.split(' ')[0];
    await transporter.sendMail({
      from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `We received your application, ${firstName}!`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
        </head>
        <body style="background-color:#FAFAFA;margin:0!important;padding:0!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="padding:60px 15px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,0.03);overflow:hidden;">

                  <!-- Accent line -->
                  <tr><td style="height:4px;background-color:#C5A059;font-size:0;line-height:0;">&nbsp;</td></tr>

                  <!-- Header -->
                  <tr>
                    <td align="center" style="padding:50px 40px 30px;background-color:#ffffff;">
                      <p style="margin:0;font-size:28px;font-weight:700;color:#111111;letter-spacing:-0.5px;">aetherstack</p>
                      <p style="margin:6px 0 0;font-size:10px;color:#888888;letter-spacing:4px;font-weight:600;text-transform:uppercase;">code smarter . ship faster</p>
                    </td>
                  </tr>

                  <!-- Divider -->
                  <tr>
                    <td align="center" style="padding:0 40px;">
                      <table border="0" cellpadding="0" cellspacing="0" width="40" style="border-top:1px solid #EAEAEA;"><tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td align="left" style="padding:40px 50px 20px;color:#444444;line-height:1.8;font-size:15px;font-weight:300;">
                      <p style="margin-top:0;">Dear <strong>${he.encode(name)}</strong>,</p>

                      <p style="margin:0 0 25px;font-size:20px;color:#111111;line-height:1.4;font-family:'Playfair Display',Georgia,serif;">
                        Thank you for applying to <i style="color:#C5A059;">Aetherstack.</i>
                      </p>

                      <p style="margin-bottom:20px;">We have successfully received your application for the <strong>${he.encode(role)}</strong> role and our team is currently reviewing it.</p>

                      <!-- Application summary box -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:30px 0;">
                        <tr>
                          <td style="background-color:#FCFBF7;border:1px solid #EBE4D5;border-radius:4px;padding:25px;">
                            <p style="margin:0 0 12px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:2px;">Your Application</p>
                            <p style="margin:4px 0;font-size:14px;color:#333;"><b>Role:</b> ${he.encode(role)}</p>
                            <p style="margin:4px 0;font-size:14px;color:#333;"><b>College:</b> ${he.encode(college)}</p>
                          </td>
                        </tr>
                      </table>

                      <!-- What happens next -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:30px 0;">
                        <tr>
                          <td style="background-color:#ffffff;border:1px solid #EAEAEA;border-left:3px solid #C5A059;padding:25px;">
                            <p style="margin:0 0 10px;color:#C5A059;font-weight:500;font-size:18px;font-style:italic;font-family:'Playfair Display',Georgia,serif;">What Happens Next</p>
                            <p style="margin:0;font-size:15px;color:#444444;line-height:1.6;">Our team will carefully review your application and reach out to you within <strong>3–5 business days</strong>. If your profile is a strong match, we will schedule a brief introductory call.</p>
                          </td>
                        </tr>
                      </table>

                      <p>In the meantime, feel free to explore our work at <a href="https://aetherstack.in" style="color:#C5A059;font-weight:600;">aetherstack.in</a>.</p>
                      <p style="margin-top:30px;">We appreciate your interest and look forward to potentially building together.</p>
                    </td>
                  </tr>

                  <!-- Sign-off -->
                  <tr>
                    <td align="left" style="padding:0 50px 50px;color:#444444;line-height:1.8;font-size:15px;">
                      <p style="margin:0;">Warmest regards,</p>
                      <p style="margin:15px 0 0;">
                        <span style="font-size:22px;color:#C5A059;display:block;font-family:'Playfair Display',Georgia,serif;">The Aetherstack Team</span>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" style="padding:30px 40px;background-color:#FAFAFA;border-top:1px solid #EAEAEA;color:#999999;font-size:11px;line-height:1.6;letter-spacing:0.5px;">
                      <p style="margin:0;">&copy; 2026 Aetherstack. All rights reserved.<br>This is an automated confirmation of your application.</p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>`
    });
  } catch (e) { console.error('CONFIRMATION EMAIL FAILED:', e.message); }

  res.json({ success: true });
});

// ── GET /api/applications ────────────────────────────────────
app.get('/api/applications', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('applications').select('*').order('id', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PATCH /api/applications/:id ──────────────────────────────
app.patch('/api/applications/:id', adminAuth, async (req, res) => {
  const { status } = req.body;
  if (!['new','reviewing','accepted','rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  await supabase.from('applications').update({ status }).eq('id', Number(req.params.id));
  res.json({ success: true });
});

// ── DELETE /api/applications/:id ─────────────────────────────
app.delete('/api/applications/:id', adminAuth, async (req, res) => {
  await supabase.from('applications').delete().eq('id', Number(req.params.id));
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
