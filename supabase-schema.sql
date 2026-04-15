-- ============================================================
--  AETHERSTACK — Marketing Team Portal
--  Run this entire file in your Supabase SQL Editor once.
-- ============================================================

-- ── 1. MARKETERS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketers (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT          NOT NULL,
  email         TEXT          NOT NULL UNIQUE,
  mobile        TEXT          NOT NULL UNIQUE,
  address       TEXT          NOT NULL,
  pincode       TEXT          NOT NULL,
  referral_code TEXT          NOT NULL UNIQUE,   -- 4-char alphanumeric, e.g. "A3F9"
  password_hash TEXT          NOT NULL,           -- bcrypt hash, never store plain text
  total_sales   INTEGER       NOT NULL DEFAULT 0,
  total_leads   INTEGER       NOT NULL DEFAULT 0,
  successful_projects INTEGER NOT NULL DEFAULT 0,
  reward_claimed     BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_tier1      BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_tier2      BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_tier3      BOOLEAN NOT NULL DEFAULT FALSE,
  claimeCREATE TABLE IF NOT EXISTS public.applications (
  id            BIGINT        PRIMARY KEY,
  name          TEXT          NOT NULL,
  emaild_tier4      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT          NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for fast referral-code lookups (collision check + client queries)
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketers_referral_code
  ON public.marketers (referral_code);

-- Index for fast email/mobile lookups during registration
CREATE INDEX IF NOT EXISTS idx_marketers_email   ON public.marketers (email);
CREATE INDEX IF NOT EXISTS idx_marketers_mobile  ON public.marketers (mobile);

-- ── 2. OTP VERIFICATIONS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email_or_mobile TEXT          NOT NULL,
  otp_code        TEXT          NOT NULL,        -- stored as bcrypt hash on backend; plain here for simplicity
  expires_at      TIMESTAMPTZ   NOT NULL,
  verified        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index so the backend can quickly find the latest OTP for a given identity
CREATE INDEX IF NOT EXISTS idx_otp_email_or_mobile
  ON public.otp_verifications (email_or_mobile, created_at DESC);

-- ── 3. PROJECTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          BIGINT        PRIMARY KEY,     -- Using Date.now() as ID on backend
  title       TEXT          NOT NULL,
  description TEXT          NOT NULL,
  tags        TEXT[]        DEFAULT '{}',
  imageUrl    TEXT,
  link        TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── 4. SUBMISSIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.submissions (
  id            BIGINT        PRIMARY KEY,     -- Using Date.now() as ID on backend
  name          TEXT          NOT NULL,
  email         TEXT          NOT NULL,
  projectType   TEXT,
  budget        TEXT,
  message       TEXT          NOT NULL,
  referralCode  TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── 5. APPLICATIONS ────────────────────────────────────────
         TEXT          NOT NULL,
  college       TEXT          NOT NULL,
  role          TEXT          NOT NULL,
  portfolio     TEXT,
  message       TEXT          NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'new',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_all_applications" ON public.applications;
CREATE POLICY "deny_all_applications" ON public.applications FOR ALL TO anon, authenticated USING (false);

-- ── 5. ROW LEVEL SECURITY ───────────────────────────────────
--
--  Strategy:
--    • The Node.js backend uses the SERVICE ROLE key (bypasses RLS).
--    • The ANON key is NEVER exposed to the browser.
--    • RLS is still enabled as a defence-in-depth measure so that
--      even if the anon key leaks, no data is readable/writable.
--
ALTER TABLE public.marketers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions        ENABLE ROW LEVEL SECURITY;

-- Block ALL direct client access — only the service-role backend may read/write.
-- (The backend uses createClient with the SERVICE_ROLE key, which bypasses RLS.)

DROP POLICY IF EXISTS "deny_all_marketers" ON public.marketers;
CREATE POLICY "deny_all_marketers" ON public.marketers FOR ALL TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "deny_all_otp" ON public.otp_verifications;
CREATE POLICY "deny_all_otp" ON public.otp_verifications FOR ALL TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "deny_all_projects" ON public.projects;
CREATE POLICY "deny_all_projects" ON public.projects FOR ALL TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "deny_all_submissions" ON public.submissions;
CREATE POLICY "deny_all_submissions" ON public.submissions FOR ALL TO anon, authenticated USING (false);

-- ── 4. AUTOMATIC CLEANUP (optional but recommended) ─────────
--  Deletes expired, unverified OTPs older than 10 minutes.
--  Schedule this via Supabase's pg_cron extension or a cron job.
--
--  To enable pg_cron in Supabase: Dashboard → Database → Extensions → pg_cron
--
-- SELECT cron.schedule(
--   'cleanup-expired-otps',
--   '*/10 * * * *',
--   $$
--     DELETE FROM public.otp_verifications
--     WHERE expires_at < NOW() AND verified = FALSE;
--   $$
-- );
