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
//
//  Strategy: generate a random 4-char alphanumeric code, then
//  attempt an INSERT. If Supabase returns a unique-constraint
//  violation (code 23505), retry up to MAX_RETRIES times.
//  This is safer than a SELECT-then-INSERT pattern which has a
//  TOCTOU race window.
//
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
    // Check for collision — Supabase parameterized query, no string concat
    const { data } = await supabase
      .from('marketers')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();

    if (!data) return code;   // no collision — safe to use
  }
  throw new Error('Could not generate a unique referral code. Try again.');
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

    // ── Validate ──
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const cleanEmail = sanitizeText(email, 254).toLowerCase();

    // ── Check if email is already registered ──
    const { data: existing } = await supabase
      .from('marketers')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'This email is already registered as a marketer.' });
    }

    // ── Invalidate any previous unverified OTPs for this email ──
    await supabase
      .from('otp_verifications')
      .delete()
      .eq('email_or_mobile', cleanEmail)
      .eq('verified', false);

    // ── Generate & store OTP ──
    const otp       = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from('otp_verifications')
      .insert({
        email_or_mobile: cleanEmail,
        otp_code:        otp,
        expires_at:      expiresAt,
        verified:        false
      });

    if (insertErr) throw insertErr;

    // ── Send email ──
    await sendOTPEmail(cleanEmail, otp);

    // NEVER return the OTP in the response — log only in dev
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${cleanEmail}: ${otp}`);
    }

    return res.json({ success: true, message: 'OTP sent to your email.' });

  } catch (err) {
    console.error('[send-otp]', err.message);
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// ── POST /api/marketing/verify-otp ──────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (!otp || !/^\d{6}$/.test(String(otp))) {
      return res.status(400).json({ error: 'OTP must be a 6-digit number.' });
    }

    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    const cleanOTP   = String(otp).trim();

    // ── Fetch the latest unverified OTP for this email ──
    const { data: record, error } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('email_or_mobile', cleanEmail)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!record) {
      return res.status(400).json({ error: 'No pending OTP found. Please request a new one.' });
    }

    // ── Check expiry ──
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // ── Check code ──
    if (record.otp_code !== cleanOTP) {
      return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
    }

    // ── Mark as verified ──
    const { error: updateErr } = await supabase
      .from('otp_verifications')
      .update({ verified: true })
      .eq('id', record.id);

    if (updateErr) throw updateErr;

    return res.json({ success: true, message: 'OTP verified successfully.' });

  } catch (err) {
    console.error('[verify-otp]', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── POST /api/marketing/register ────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, email, mobile, address, pincode } = req.body;

    // ── Validate all fields ──
    const { password } = req.body;

    const errors = [];
    if (!name     || sanitizeText(name).length < 2)   errors.push('Name must be at least 2 characters.');
    if (!email    || !isValidEmail(email))             errors.push('Valid email is required.');
    if (!mobile   || !isValidMobile(mobile))           errors.push('Mobile must be a valid 10-digit Indian number.');
    if (!address  || sanitizeText(address).length < 5) errors.push('Address must be at least 5 characters.');
    if (!pincode  || !isValidPincode(pincode))         errors.push('Pincode must be a valid 6-digit Indian pincode.');
    if (!password || !isValidPassword(password))       errors.push('Password must be at least 8 characters with a letter and a number.');

    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const cleanEmail   = sanitizeText(email, 254).toLowerCase();
    const cleanMobile  = sanitizeText(mobile, 10);
    const cleanName    = sanitizeText(name, 100);
    const cleanAddress = sanitizeText(address, 300);
    const cleanPincode = sanitizeText(pincode, 6);
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Confirm OTP was verified for this email ──
    const { data: otpRecord } = await supabase
      .from('otp_verifications')
      .select('id, verified, expires_at')
      .eq('email_or_mobile', cleanEmail)
      .eq('verified', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return res.status(403).json({ error: 'Email not verified. Please complete OTP verification first.' });
    }

    // ── Guard: verified OTP must be recent (within 30 min) ──
    const verifiedAge = Date.now() - new Date(otpRecord.expires_at).getTime();
    if (verifiedAge > 30 * 60 * 1000) {
      return res.status(403).json({ error: 'Verification session expired. Please start over.' });
    }

    // ── Check for duplicate email / mobile ──
    const { data: dupEmail } = await supabase
      .from('marketers').select('id').eq('email', cleanEmail).maybeSingle();
    if (dupEmail) return res.status(409).json({ error: 'Email already registered.' });

    const { data: dupMobile } = await supabase
      .from('marketers').select('id').eq('mobile', cleanMobile).maybeSingle();
    if (dupMobile) return res.status(409).json({ error: 'Mobile number already registered.' });

    // ── Generate unique referral code (race-condition safe) ──
    const referralCode = await generateUniqueReferralCode();

    // ── Insert marketer ──
    const { data: marketer, error: insertErr } = await supabase
      .from('marketers')
      .insert({
        name:          cleanName,
        email:         cleanEmail,
        mobile:        cleanMobile,
        address:       cleanAddress,
        pincode:       cleanPincode,
        referral_code: referralCode,
        password_hash: passwordHash,
        total_sales:   0,
        total_leads:   0
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // ── Clean up used OTP records ──
    await supabase
      .from('otp_verifications')
      .delete()
      .eq('email_or_mobile', cleanEmail);

    // ── Issue JWT ──
    const token = signToken({ id: marketer.id, email: marketer.email });

    return res.status(201).json({
      success: true,
      message: 'Welcome to the Aetherstack Marketing Team!',
      token,
      referral_code: marketer.referral_code
    });

  } catch (err) {
    console.error('[register]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/marketing/login ────────────────────────────────
//  Email + password login for registered marketers.
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const cleanEmail = sanitizeText(email, 254).toLowerCase();

    // ── Fetch marketer with password hash ──
    // Use a generic error message to prevent user enumeration attacks
    const { data: marketer } = await supabase
      .from('marketers')
      .select('id, email, password_hash')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (!marketer) {
      // Deliberate delay to prevent timing attacks
      await bcrypt.hash('dummy', 12);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // ── Verify password ──
    const match = await bcrypt.compare(password, marketer.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken({ id: marketer.id, email: marketer.email });
    return res.json({ success: true, token });

  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GET /api/marketing/admin/stats ──────────────────────────
// Admin-only: returns all marketers + aggregate stats.
// Protected by ADMIN_SECRET header (same as existing admin routes).
router.get('/admin/stats', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}, async (req, res) => {
  try {
    const { data: marketers, error } = await supabase
      .from('marketers')
      .select('id, name, email, mobile, referral_code, total_leads, total_sales, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const totalMarketers = marketers.length;
    const totalLeads     = marketers.reduce((s, m) => s + (m.total_leads || 0), 0);
    const totalSales     = marketers.reduce((s, m) => s + (m.total_sales || 0), 0);

    // Add default status if column doesn't exist yet
    const enriched = marketers.map(m => ({ ...m, status: m.status || 'active' }));

    return res.json({ success: true, stats: { totalMarketers, totalLeads, totalSales }, marketers: enriched });
  } catch (err) {
    console.error('[admin/stats]', err.message);
    return res.status(500).json({ error: 'Failed to load marketer stats.' });
  }
});

// ── PATCH /api/marketing/admin/update-sales ───────────────
// Update sales, leads, or status (active/banned/revoked).
router.patch('/admin/update-sales', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.body.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, async (req, res) => {
  try {
    const { id, total_sales, total_leads, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required.' });
    const updates = {};
    if (total_sales !== undefined) updates.total_sales = Number(total_sales);
    if (total_leads !== undefined) updates.total_leads = Number(total_leads);
    if (status      !== undefined) updates.status      = status; // 'active'|'banned'|'revoked'
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    const { error } = await supabase.from('marketers').update(updates).eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin/update-marketer]', err.message);
    return res.status(500).json({ error: 'Failed to update marketer.' });
  }
});

// ── DELETE /api/marketing/admin/delete/:id ─────────────────
router.delete('/admin/delete/:id', (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, async (req, res) => {
  try {
    const { error } = await supabase.from('marketers').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin/delete]', err.message);
    return res.status(500).json({ error: 'Failed to delete marketer.' });
  }
});

// ── POST /api/marketing/validate-code ──────────────────────
// Public endpoint — called live as the user types in the contact form.
// Returns marketer's first name so the UI can show "✓ Valid — Abhishek"
router.post('/validate-code', async (req, res) => {
  try {
    const code = sanitizeText(req.body.referral_code || '', 4).toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      return res.status(400).json({ valid: false });
    }
    const { data } = await supabase
      .from('marketers')
      .select('name')
      .eq('referral_code', code)
      .maybeSingle();

    if (!data) return res.json({ valid: false });
    // Return only first name for privacy
    return res.json({ valid: true, name: data.name.split(' ')[0] });
  } catch (err) {
    console.error('[validate-code]', err.message);
    return res.status(500).json({ valid: false });
  }
});

// ── GET /api/marketing/dashboard ────────────────────────────
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const { data: marketer, error } = await supabase
      .from('marketers')
      .select('name, email, referral_code, total_leads, total_sales, created_at')
      .eq('id', req.marketer.id)
      .single();

    if (error || !marketer) {
      return res.status(404).json({ error: 'Marketer account not found.' });
    }

    return res.json({ success: true, data: marketer });

  } catch (err) {
    console.error('[dashboard]', err.message);
    return res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

module.exports = router;
