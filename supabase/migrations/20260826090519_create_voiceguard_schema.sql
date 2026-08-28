/*
# VoiceGuard — Core Detection Schema

## Purpose
Stores voice-clone detection analyses, individual signal results, triggered alerts,
and landing-page demo runs for the VoiceGuard real-time voice integrity platform.

## Plain-English Summary
This migration creates four tables that together capture the full lifecycle of a
voice impersonation detection event — from the moment a call is analyzed, through
the individual acoustic/prosody/identity signals checked, to any alert raised and
the recommended follow-up action. It also tracks each time a visitor runs the
interactive demo on the landing page so the public stats reflect real usage.

## 1. New Tables

### call_analyses
The central record for each voice analysis session (live call or demo).
- `id` (uuid, PK)
- `caller_label` (text) — display name or masked number for the caller
- `caller_reference` (text) — phone number or contact handle, masked is fine
- `call_context` (text) — e.g. "high-value transfer", "privileged access", "general"
- `duration_seconds` (int) — length of the analyzed segment
- `risk_score` (int, 0–100) — computed impersonation risk
- `verdict` (text) — one of: authentic, suspicious, impersonation, pending
- `language` (text) — detected or declared language/dialect (e.g. "en-IN", "hi-IN")
- `status` (text) — one of: active, completed, escalated
- `created_at` (timestamptz, defaults to now)

### detection_signals
Individual signal-level results tied to a call analysis.
- `id` (uuid, PK)
- `analysis_id` (uuid, FK → call_analyses, cascade delete)
- `signal_type` (text) — one of: spectral, prosody, speaker_identity, behavioral
- `signal_label` (text) — human-readable label shown in the UI
- `score` (int, 0–100) — confidence that this signal is natural/authentic
- `verdict` (text) — one of: natural, consistent, verified, mismatch, anomaly
- `detail` (text) — optional explanation or note
- `created_at` (timestamptz, defaults to now)

### alerts
Alerts raised when an analysis crosses a risk threshold.
- `id` (uuid, PK)
- `analysis_id` (uuid, FK → call_analyses, cascade delete)
- `severity` (text) — one of: info, warning, critical
- `message` (text) — alert headline shown to the user
- `recommendation` (text) — suggested next step (call-back, MFA, escalate)
- `acknowledged` (boolean, default false)
- `created_at` (timestamptz, defaults to now)

### demo_runs
Each time a visitor activates the interactive demo on the landing page.
- `id` (uuid, PK)
- `final_state` (text) — the terminal detection state (e.g. "alert", "safe")
- `risk_score` (int, 0–100) — the risk score shown at the end of the demo
- `created_at` (timestamptz, defaults to now)

## 2. Security
- RLS enabled on every table.
- This is a single-tenant app with no sign-in screen, so all policies use
  `TO anon, authenticated` — the frontend's anon-key client can read and write
  its own shared data. `USING (true)` / `WITH CHECK (true)` is intentional here
  because the data is public/shared, not because ownership checks were skipped.
- Four separate policies (select/insert/update/delete) per table — no `FOR ALL`.

## 3. Indexes
- `detection_signals` by `analysis_id` (signal lookups per call).
- `alerts` by `analysis_id` (alert lookups per call).
- `call_analyses` by `created_at` desc (recent-first listing).
- `demo_runs` by `created_at` desc (aggregate stats / recent runs).

## 4. Notes
- No `user_id` columns and no `auth.users` references — there is no auth flow.
- No destructive operations — all tables are new (`IF NOT EXISTS`).
- Policies are dropped before re-creation to keep the migration idempotent.
*/

-- ── call_analyses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_label    text NOT NULL,
  caller_reference text,
  call_context    text NOT NULL DEFAULT 'general',
  duration_seconds int  NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  risk_score      int  NOT NULL DEFAULT 0  CHECK (risk_score BETWEEN 0 AND 100),
  verdict         text NOT NULL DEFAULT 'pending'
                  CHECK (verdict IN ('authentic','suspicious','impersonation','pending')),
  language        text NOT NULL DEFAULT 'en-IN',
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed','escalated')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE call_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_call_analyses" ON call_analyses;
CREATE POLICY "anon_select_call_analyses" ON call_analyses
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_call_analyses" ON call_analyses;
CREATE POLICY "anon_insert_call_analyses" ON call_analyses
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_call_analyses" ON call_analyses;
CREATE POLICY "anon_update_call_analyses" ON call_analyses
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_call_analyses" ON call_analyses;
CREATE POLICY "anon_delete_call_analyses" ON call_analyses
  FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_call_analyses_created_at
  ON call_analyses (created_at DESC);

-- ── detection_signals ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS detection_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id  uuid NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  signal_type  text NOT NULL
               CHECK (signal_type IN ('spectral','prosody','speaker_identity','behavioral')),
  signal_label text NOT NULL,
  score        int  NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  verdict      text NOT NULL DEFAULT 'natural'
               CHECK (verdict IN ('natural','consistent','verified','mismatch','anomaly')),
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE detection_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_detection_signals" ON detection_signals;
CREATE POLICY "anon_select_detection_signals" ON detection_signals
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_detection_signals" ON detection_signals;
CREATE POLICY "anon_insert_detection_signals" ON detection_signals
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_detection_signals" ON detection_signals;
CREATE POLICY "anon_update_detection_signals" ON detection_signals
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_detection_signals" ON detection_signals;
CREATE POLICY "anon_delete_detection_signals" ON detection_signals
  FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_detection_signals_analysis_id
  ON detection_signals (analysis_id);

-- ── alerts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid NOT NULL REFERENCES call_analyses(id) ON DELETE CASCADE,
  severity       text NOT NULL DEFAULT 'warning'
                 CHECK (severity IN ('info','warning','critical')),
  message        text NOT NULL,
  recommendation text,
  acknowledged   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_alerts" ON alerts;
CREATE POLICY "anon_select_alerts" ON alerts
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_alerts" ON alerts;
CREATE POLICY "anon_insert_alerts" ON alerts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_alerts" ON alerts;
CREATE POLICY "anon_update_alerts" ON alerts
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_alerts" ON alerts;
CREATE POLICY "anon_delete_alerts" ON alerts
  FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_alerts_analysis_id
  ON alerts (analysis_id);

-- ── demo_runs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demo_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  final_state text NOT NULL DEFAULT 'idle'
              CHECK (final_state IN ('idle','scanning','safe','alert')),
  risk_score  int  NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE demo_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_demo_runs" ON demo_runs;
CREATE POLICY "anon_select_demo_runs" ON demo_runs
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_demo_runs" ON demo_runs;
CREATE POLICY "anon_insert_demo_runs" ON demo_runs
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_demo_runs" ON demo_runs;
CREATE POLICY "anon_update_demo_runs" ON demo_runs
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_demo_runs" ON demo_runs;
CREATE POLICY "anon_delete_demo_runs" ON demo_runs
  FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_demo_runs_created_at
  ON demo_runs (created_at DESC);
