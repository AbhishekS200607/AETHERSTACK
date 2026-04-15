-- ============================================================
--  AETHERSTACK — Full Database Schema
--  Run this entire file in your Supabase SQL Editor once.
-- ============================================================

-- ── 1. MARKETERS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  email               TEXT        NOT NULL UNIQUE,
  mobile              TEXT        NOT NULL UNIQUE,
  address             TEXT        NOT NULL,
  pincode             TEXT        NOT NULL,
  referral_code       TEXT        NOT NULL UNIQUE,
  password_hash       TEXT        NOT NULL,
  total_sales         INTEGER     NOT NULL DEFAULT 0,
  total_leads         INTEGER     NOT NULL DEFAULT 0,
  successful_projects INTEGER     NOT NULL DEFAULT 0,
  reward_claimed      BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_tier1       BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_tier2       BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_tier3       BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_tier4       BOOLEAN     NOT NULL DEFAULT FALSE,
  status              TEXT        NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketers_referral_code ON public.marketers (referral_code);
CREATE INDEX IF NOT EXISTS idx_marketers_email  ON public.marketers (email);
CREATE INDEX IF NOT EXISTS idx_marketers_mobile ON public.marketers (mobile);

-- ── 2. OTP VERIFICATIONS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_or_mobile TEXT        NOT NULL,
  otp_code        TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  verified        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_email_or_mobile ON public.otp_verifications (email_or_mobile, created_at DESC);

-- ── 3. PROJECTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  tags        TEXT[]      DEFAULT '{}',
  imageUrl    TEXT,
  link        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. SUBMISSIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.submissions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  projectType  TEXT,
  budget       TEXT,
  message      TEXT        NOT NULL,
  referralCode TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. APPLICATIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.applications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  college    TEXT        NOT NULL,
  role       TEXT        NOT NULL,
  portfolio  TEXT,
  message    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. ROW LEVEL SECURITY ───────────────────────────────────
ALTER TABLE public.marketers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_marketers"    ON public.marketers;
DROP POLICY IF EXISTS "deny_all_otp"          ON public.otp_verifications;
DROP POLICY IF EXISTS "deny_all_projects"     ON public.projects;
DROP POLICY IF EXISTS "deny_all_submissions"  ON public.submissions;
DROP POLICY IF EXISTS "deny_all_applications" ON public.applications;

CREATE POLICY "deny_all_marketers"    ON public.marketers         FOR ALL TO anon, authenticated USING (false);
CREATE POLICY "deny_all_otp"          ON public.otp_verifications FOR ALL TO anon, authenticated USING (false);
CREATE POLICY "deny_all_projects"     ON public.projects          FOR ALL TO anon, authenticated USING (false);
CREATE POLICY "deny_all_submissions"  ON public.submissions       FOR ALL TO anon, authenticated USING (false);
CREATE POLICY "deny_all_applications" ON public.applications      FOR ALL TO anon, authenticated USING (false);

-- ── 7. ATOMIC INCREMENTS (RPC FUNCTIONS) ────────────────────
--  Handles race conditions when multiple leads arrive at once.
CREATE OR REPLACE FUNCTION public.increment_leads(m_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.marketers
  SET total_leads = total_leads + 1
  WHERE id = m_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 7. MIGRATE EXISTING TABLES (run if tables already exist) ─
-- ALTER TABLE public.projects     ALTER COLUMN id TYPE UUID USING gen_random_uuid();
-- ALTER TABLE public.projects     ALTER COLUMN id SET DEFAULT gen_random_uuid();
-- ALTER TABLE public.submissions  ALTER COLUMN id TYPE UUID USING gen_random_uuid();
-- ALTER TABLE public.submissions  ALTER COLUMN id SET DEFAULT gen_random_uuid();
-- ALTER TABLE public.applications ALTER COLUMN id TYPE UUID USING gen_random_uuid();
-- ALTER TABLE public.applications ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ── 8. OPTIONAL: Auto-cleanup expired OTPs ──────────────────
-- SELECT cron.schedule('cleanup-expired-otps', '*/10 * * * *',
--   $$ DELETE FROM public.otp_verifications WHERE expires_at < NOW() AND verified = FALSE; $$
-- );
