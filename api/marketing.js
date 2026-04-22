'use strict';
// ============================================================
//  api/marketing.js — Aetherstack Marketing Team Portal
//  Mounted at /api/marketing in api/index.js
// ============================================================

const express    = require('express');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const router = express.Router();

// ── Supabase client (SERVICE ROLE — bypasses RLS, never expose to browser) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // <-- SERVICE key, NOT the anon key
);

// ── Nodemailer transporter ───────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  secure: true,                       // force TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ── JWT helper ───────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });

  try {
    req.marketer = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ── Rate limiters ────────────────────────────────────────────
//  /send-otp  : max 5 requests per 15 min per IP  (prevents OTP spam)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait 15 minutes.' }
});

//  /login     : max 10 attempts per 15 min per IP  (prevents brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

//  /register  : max 3 attempts per hour per IP  (prevents account farming)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' }
});

// ── Input validators ─────────────────────────────────────────
function isValidEmail(v) {
  // RFC-5322 simplified — no raw string concat ever reaches the DB
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}
function isValidMobile(v) {
  return /^[6-9]\d{9}$/.test(String(v).trim());   // Indian 10-digit mobile
}
function isValidPincode(v) {
  return /^\d{6}$/.test(String(v).trim());          // Indian 6-digit pincode
}
function isValidPassword(v) {
  // Min 8 chars, at least one letter and one number
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(v));
}
function sanitizeText(v, maxLen = 200) {
  return String(v).trim().slice(0, maxLen);
}

// ── OTP generator ────────────────────────────────────────────
function generateOTP() {
  // Cryptographically random 6-digit string (no Math.random)
  const { randomInt } = require('crypto');
  return String(randomInt(100000, 999999));
}

// ── Referral code generator (race-condition safe) ────────────
const CHARSET     = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
const MAX_RETRIES = 10;

function randomCode() {
  const { randomInt } = require('crypto');
  let code = '';
  for (let i = 0; i < 4; i++) code += CHARSET[randomInt(0, CHARSET.length)];
  return code;
}

async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = randomCode();
    const { data } = await supabase
      .from('marketers')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();

    if (!data) return code;
  }
  throw new Error('Could not generate a unique referral code. Try again.');
}

// ── Welcome email sender ────────────────────────────────────
async function sendWelcomeEmail(name, email, referralCode) {
  const firstName = name.split(' ')[0];
  const listItems = [
    'Share your referral code seamlessly with your professional network.',
    'Invite individuals, startups, or established businesses seeking bespoke project development.',
    'Promote our digital services and connect high-value clients with our team.'
  ];
  await transporter.sendMail({
    from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Welcome to the Aetherstack Marketing Team, ${firstName}!`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
        <style>
          body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
          table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
          table{border-collapse:collapse!important}
          body{height:100%!important;margin:0!important;padding:0!important;width:100%!important}
          .premium-font{font-family:'Playfair Display',Georgia,serif!important}
          .body-font{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif!important}
        </style>
      </head>
      <body style="background-color:#FAFAFA;margin:0!important;padding:0!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center" style="padding:60px 15px;">

              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,0.03);overflow:hidden;">

                <!-- Gold accent line -->
                <tr>
                  <td style="height:4px;background-color:#C5A059;font-size:0;line-height:0;">&nbsp;</td>
                </tr>

                <!-- Header -->
                <tr>
                  <td align="center" style="padding:50px 40px 30px;background-color:#ffffff;">
                    <p style="margin:0;font-size:28px;font-weight:700;color:#111111;letter-spacing:-0.5px;">aetherstack</p>
                    <p class="body-font" style="margin:6px 0 0;font-size:10px;color:#888888;letter-spacing:4px;font-weight:600;text-transform:uppercase;">code smarter . ship faster</p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td align="center" style="padding:0 40px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="40" style="border-top:1px solid #EAEAEA;">
                      <tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td align="left" class="body-font" style="padding:40px 50px 20px;color:#444444;line-height:1.8;font-size:15px;font-weight:300;">

                    <p style="margin-top:0;">Dear <strong>${name}</strong>,</p>

                    <!-- Welcome line -->
                    <p class="premium-font" style="margin:0 0 25px;font-size:20px;color:#111111;line-height:1.4;">
                      Welcome to the <i style="color:#C5A059;">Marketing Team</i> at Aetherstack.
                    </p>

                    <p style="margin-bottom:20px;">We are thrilled to have you onboard and look forward to your contributions in expanding our reach and cultivating new opportunities.</p>

                    <p>As an integral part of your role, we are introducing our <strong>Referral Program</strong>. You have been assigned a unique referral code to invite prospective clients for project collaborations.</p>

                    <!-- Referral Code Box -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:40px 0;">
                      <tr>
                        <td align="center" style="background-color:#FCFBF7;border:1px solid #EBE4D5;border-radius:4px;padding:35px 20px;">
                          <p class="body-font" style="margin:0 0 12px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:2px;">Your Exclusive Referral Code</p>
                          <p class="premium-font" style="margin:0;font-size:28px;font-weight:500;color:#C5A059;letter-spacing:3px;">${referralCode}</p>
                        </td>
                      </tr>
                    </table>

                    <p style="margin-bottom:25px;font-weight:600;color:#111111;">You are encouraged to:</p>

                    <!-- List items with tick circles -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:40px;">
                      ${listItems.map(text => `
                      <tr>
                        <td width="32" valign="top" style="padding-bottom:18px;padding-top:1px;">
                          <table border="0" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:22px;height:22px;background-color:#C5A059;border-radius:50%;text-align:center;vertical-align:middle;">
                                <span style="font-size:13px;color:#ffffff;font-weight:700;line-height:22px;">&#10003;</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td align="left" valign="top" class="body-font" style="padding-bottom:18px;color:#555555;">${text}</td>
                      </tr>`).join('')}
                    </table>

                    <!-- Benefit callout -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:30px 0;">
                      <tr>
                        <td align="left" style="background-color:#ffffff;border:1px solid #EAEAEA;border-left:3px solid #C5A059;padding:25px;">
                          <p class="premium-font" style="margin:0 0 10px;color:#C5A059;font-weight:500;font-size:18px;font-style:italic;">The Referral Benefit</p>
                          <p class="body-font" style="margin:0;font-size:15px;color:#444444;line-height:1.6;">For every successful project acquired through your referral code, you will be rewarded with <strong>7% to 10% of the project's total profit</strong>.</p>
                        </td>
                      </tr>
                    </table>

                    <p style="margin-top:30px;">This presents an exceptional opportunity to accelerate your professional growth while earning performance-based incentives.</p>
                    <p>Should you require any strategic support or have questions regarding client outreach, our leadership team is always available to assist you.</p>
                    <p style="margin-top:30px;">Once again, welcome. We are excited to build and achieve great success together.</p>

                  </td>
                </tr>

                <!-- Sign-off -->
                <tr>
                  <td align="left" class="body-font" style="padding:0 50px 50px;color:#444444;line-height:1.8;font-size:15px;">
                    <p style="margin:0;">Warmest regards,</p>
                    <p style="margin:15px 0 0;">
                      <span class="premium-font" style="font-size:22px;color:#111111;display:block;margin-bottom:5px;">Marketing Team</span>
                      <span style="color:#C5A059;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Aetherstack</span>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td align="center" class="body-font" style="padding:30px 40px;background-color:#FAFAFA;border-top:1px solid #EAEAEA;color:#999999;font-size:11px;line-height:1.6;letter-spacing:0.5px;">
                    <p style="margin:0;">&copy; 2026 Aetherstack. All rights reserved.<br>This communication is intended for registered team members.</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `
  });
}

// ── OTP email sender ─────────────────────────────────────────
async function sendOTPEmail(email, otp) {
  await transporter.sendMail({
    from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Aetherstack Marketer OTP',
    html: `
      <div style="font-family:'Space Grotesk',sans-serif;background:#080808;padding:40px;border-radius:16px;max-width:480px;margin:auto;">
        <h2 style="color:#FF6B4A;margin:0 0 8px">Aetherstack</h2>
        <p style="color:#aaa;font-size:13px;margin:0 0 32px">Marketing Team Portal</p>
        <p style="color:#fff;font-size:16px">Your one-time verification code is:</p>
        <div style="background:#1a1a1a;border:1px solid #FF6B4A33;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#FF6B4A">${otp}</span>
        </div>
        <p style="color:#666;font-size:13px">This code expires in <b style="color:#fff">5 minutes</b>. Do not share it with anyone.</p>
      </div>
    `
  });
}

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════

// ── POST /api/marketing/send-otp ────────────────────────────
router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    const { data: existing } = await supabase.from('marketers').select('id').eq('email', cleanEmail).maybeSingle();
    if (existing) return res.status(409).json({ error: 'This email is already registered.' });
    await supabase.from('otp_verifications').delete().eq('email_or_mobile', cleanEmail).eq('verified', false);
    const otp       = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: insertErr } = await supabase.from('otp_verifications').insert({ email_or_mobile: cleanEmail, otp_code: otp, expires_at: expiresAt, verified: false });
    if (insertErr) throw insertErr;
    await sendOTPEmail(cleanEmail, otp);
    if (process.env.NODE_ENV !== 'production') console.log(`[DEV] OTP: ${otp}`);
    return res.json({ success: true, message: 'OTP sent to your email.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ── POST /api/marketing/verify-otp ──────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    const cleanOTP   = String(otp).trim();
    const { data: record, error } = await supabase.from('otp_verifications').select('*').eq('email_or_mobile', cleanEmail).eq('verified', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !record) return res.status(400).json({ error: 'Invalid or expired OTP.' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP has expired.' });
    if (record.otp_code !== cleanOTP) return res.status(400).json({ error: 'Incorrect OTP.' });
    await supabase.from('otp_verifications').update({ verified: true }).eq('id', record.id);
    return res.json({ success: true, message: 'OTP verified successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Verification failed.' });
  }
});

// ── POST /api/marketing/register ────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, email, mobile, address, pincode, password } = req.body;
    const cleanEmail   = sanitizeText(email, 254).toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    const { data: otpRecord } = await supabase.from('otp_verifications').select('id, verified, expires_at').eq('email_or_mobile', cleanEmail).eq('verified', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otpRecord) return res.status(403).json({ error: 'Email not verified.' });
    const referralCode = await generateUniqueReferralCode();
    const { data: marketer, error: insertErr } = await supabase.from('marketers').insert({ name: sanitizeText(name, 100), email: cleanEmail, mobile: sanitizeText(mobile, 10), address: sanitizeText(address, 300), pincode: sanitizeText(pincode, 6), referral_code: referralCode, password_hash: passwordHash, total_sales: 0, total_leads: 0, successful_projects: 0 }).select().single();
    if (insertErr) throw insertErr;
    await supabase.from('otp_verifications').delete().eq('email_or_mobile', cleanEmail);
    sendWelcomeEmail(marketer.name, cleanEmail, referralCode).catch(e => console.error(e));
    const token = signToken({ id: marketer.id, email: marketer.email });
    return res.status(201).json({ success: true, token, referral_code: marketer.referral_code });
  } catch (err) {
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── POST /api/marketing/login ────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    const { data: marketer } = await supabase.from('marketers').select('id, email, password_hash').eq('email', cleanEmail).maybeSingle();
    if (!marketer || !(await bcrypt.compare(password, marketer.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = signToken({ id: marketer.id, email: marketer.email });
    return res.json({ success: true, token });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed.' });
  }
});

// ── GET /api/marketing/admin/stats ──────────────────────────
router.get('/admin/stats', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, async (req, res) => {
  try {
    const { data: marketers, error } = await supabase.from('marketers').select('id, name, email, mobile, referral_code, total_leads, total_sales, successful_projects, claimed_tier1, claimed_tier2, claimed_tier3, claimed_tier4, created_at, status').order('created_at', { ascending: false });
    if (error) throw error;
    const totalMarketers = marketers.length;
    const totalLeads     = marketers.reduce((s, m) => s + (m.total_leads || 0), 0);
    const totalSales     = marketers.reduce((s, m) => s + (m.total_sales || 0), 0);
    return res.json({ success: true, stats: { totalMarketers, totalLeads, totalSales }, marketers });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load marketer stats.' });
  }
});

// ── PATCH /api/marketing/admin/update-sales ───────────────
router.patch('/admin/update-sales', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.body.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, async (req, res) => {
  try {
    const { id, total_sales, total_leads, successful_projects, claimed_tier1, claimed_tier2, claimed_tier3, claimed_tier4, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required.' });
    const updates = {};
    if (total_sales !== undefined && !isNaN(Number(total_sales))) updates.total_sales = Number(total_sales);
    if (total_leads !== undefined && !isNaN(Number(total_leads))) updates.total_leads = Number(total_leads);
    if (successful_projects !== undefined && !isNaN(Number(successful_projects))) updates.successful_projects = Number(successful_projects);
    if (claimed_tier1 !== undefined) updates.claimed_tier1 = Boolean(claimed_tier1);
    if (claimed_tier2 !== undefined) updates.claimed_tier2 = Boolean(claimed_tier2);
    if (claimed_tier3 !== undefined) updates.claimed_tier3 = Boolean(claimed_tier3);
    if (claimed_tier4 !== undefined) updates.claimed_tier4 = Boolean(claimed_tier4);
    if (status !== undefined) updates.status = status;
    const { error } = await supabase.from('marketers').update(updates).eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── DELETE /api/marketing/admin/delete/:id ─────────────────
router.delete('/admin/delete/:id', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, async (req, res) => {
  try {
    await supabase.from('marketers').delete().eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete.' });
  }
});

// ── GET /api/marketing/leaderboard ─────────────────────────
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('marketers').select('id, name, referral_code, total_leads, total_sales, successful_projects').order('total_sales', { ascending: false }).limit(20);
    if (error) throw error;
    return res.json({ success: true, leaderboard: data });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

// ── Tier config ──────────────────────────────────────────────
const TIER_CONFIG = {
  1: { projects: 10,  name: 'Bronze',   reward: 'Official Aetherstack T-Shirt',       col: 'claimed_tier1' },
  2: { projects: 25,  name: 'Silver',   reward: 'Elite Hoodie + Branded Mug',         col: 'claimed_tier2' },
  3: { projects: 50,  name: 'Gold',     reward: 'Desk Plaque + Tech Kit (Powerbank)', col: 'claimed_tier3' },
  4: { projects: 100, name: 'Platinum', reward: 'Premium Backpack + Team Dinner',     col: 'claimed_tier4' }
};

// ── GET /api/marketing/dashboard ────────────────────────────
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const { data: marketer, error } = await supabase
      .from('marketers')
      .select('name, email, mobile, address, pincode, referral_code, total_leads, total_sales, successful_projects, claimed_tier1, claimed_tier2, claimed_tier3, claimed_tier4, created_at')
      .eq('id', req.marketer.id)
      .single();
    if (error || !marketer) return res.status(404).json({ error: 'Not found.' });
    return res.json({ success: true, data: marketer });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

// ── POST /api/marketing/claim-reward ────────────────────────
// Body: { tier: 1|2|3|4 }
router.post('/claim-reward', requireAuth, async (req, res) => {
  try {
    const tier = parseInt(req.body.tier);
    if (![1, 2, 3, 4].includes(tier)) return res.status(400).json({ error: 'Invalid tier.' });
    const cfg = TIER_CONFIG[tier];

    const { data: marketer, error } = await supabase
      .from('marketers')
      .select(`name, email, mobile, address, pincode, successful_projects, ${cfg.col}`)
      .eq('id', req.marketer.id)
      .single();

    if (error || !marketer) return res.status(404).json({ error: 'Not found.' });
    if (marketer[cfg.col]) return res.status(409).json({ error: `Tier ${tier} already claimed.` });
    if ((marketer.successful_projects || 0) < cfg.projects) {
      return res.status(403).json({ error: `You need ${cfg.projects} completed projects to claim ${cfg.name} tier.` });
    }

    await supabase.from('marketers').update({ [cfg.col]: true }).eq('id', req.marketer.id);

    transporter.sendMail({
      from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `🎁 ${cfg.name} Tier Claimed — ${marketer.name}`,
      html: `<div style="font-family:sans-serif;padding:20px;color:#333">
        <h2 style="color:#ff6035">Tier ${tier} Reward Claim</h2>
        <p><b>Marketer:</b> ${marketer.name}</p>
        <p><b>Email:</b> ${marketer.email}</p>
        <p><b>Tier:</b> ${cfg.name} — ${cfg.reward}</p>
        <p><b>Projects:</b> ${marketer.successful_projects}</p>
        <p><b>Address:</b> ${marketer.address || 'N/A'}, ${marketer.pincode || ''}</p>
        <p><b>Mobile:</b> ${marketer.mobile || 'N/A'}</p>
      </div>`
    }).catch(() => {});

    transporter.sendMail({
      from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
      to: marketer.email,
      subject: `🎉 Your ${cfg.name} reward is confirmed!`,
      html: `<div style="font-family:sans-serif;padding:20px;color:#333">
        <h2 style="color:#ff6035">Congratulations, ${marketer.name.split(' ')[0]}!</h2>
        <p>Your <b>${cfg.name} tier</b> reward has been confirmed.</p>
        <p><b>Reward:</b> ${cfg.reward}</p>
        <p>We'll ship it to your registered address shortly. Thank you for your amazing work!</p>
      </div>`
    }).catch(() => {});

    return res.json({ success: true, message: `${cfg.name} reward claimed! We'll ship your ${cfg.reward} soon.` });
  } catch (err) {
    console.error('[claim-reward]', err.message);
    return res.status(500).json({ error: 'Failed to claim reward.' });
  }
});

// ── PATCH /api/marketing/update-profile ──────────────────────
router.patch('/update-profile', requireAuth, async (req, res) => {
  try {
    const { mobile, address, pincode, otp } = req.body;
    const cleanEmail = req.marketer.email.toLowerCase();

    if (!otp) return res.status(400).json({ error: 'OTP is required to update profile.' });

    // Verify OTP
    const { data: record, error: otpErr } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('email_or_mobile', cleanEmail)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr || !record || record.otp_code !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired.' });
    }

    const updates = {};
    if (mobile !== undefined) {
      if (!isValidMobile(mobile)) return res.status(400).json({ error: 'Invalid mobile number.' });
      updates.mobile = sanitizeText(mobile, 10);
    }
    if (address !== undefined) {
      if (address.length < 5) return res.status(400).json({ error: 'Address too short.' });
      updates.address = sanitizeText(address, 300);
    }
    if (pincode !== undefined) {
      if (!isValidPincode(pincode)) return res.status(400).json({ error: 'Invalid pincode.' });
      updates.pincode = sanitizeText(pincode, 6);
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No changes provided.' });

    const { error: updateErr } = await supabase.from('marketers').update(updates).eq('id', req.marketer.id);
    if (updateErr) throw updateErr;

    // Mark OTP as verified/used
    await supabase.from('otp_verifications').update({ verified: true }).eq('id', record.id);

    return res.json({ success: true, message: 'Profile updated successfully!' });
  } catch (err) {
    console.error('[update-profile]', err.message);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── POST /api/marketing/send-profile-otp ────────────────────
router.post('/send-profile-otp', requireAuth, otpLimiter, async (req, res) => {
  try {
    const cleanEmail = req.marketer.email.toLowerCase();
    
    // Clear old unverified OTPs for this email
    await supabase.from('otp_verifications').delete().eq('email_or_mobile', cleanEmail).eq('verified', false);
    
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    const { error: insertErr } = await supabase.from('otp_verifications').insert({
      email_or_mobile: cleanEmail,
      otp_code: otp,
      expires_at: expiresAt,
      verified: false
    });
    
    if (insertErr) throw insertErr;
    
    await sendOTPEmail(cleanEmail, otp);
    if (process.env.NODE_ENV !== 'production') console.log(`[PROFILE-UPDATE] OTP for ${cleanEmail}: ${otp}`);
    
    return res.json({ success: true, message: 'OTP sent to your email.' });
  } catch (err) {
    console.error('[send-profile-otp]', err.message);
    return res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ── POST /api/marketing/validate-code ──────────────────────
router.post('/validate-code', async (req, res) => {
  try {
    const code = sanitizeText(req.body.referral_code || '', 4).toUpperCase();
    const { data } = await supabase.from('marketers').select('name').eq('referral_code', code).maybeSingle();
    if (!data) return res.json({ valid: false });
    return res.json({ valid: true, name: data.name.split(' ')[0] });
  } catch (err) {
    return res.json({ valid: false });
  }
});

module.exports = router;