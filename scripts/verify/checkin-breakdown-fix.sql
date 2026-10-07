-- Verification script for admin_event_category_breakdown fix
-- Run against DEV database after applying migration 20260922000000
-- Usage: psql $SUPABASE_DB_URL -f scripts/verify/checkin-breakdown-fix.sql
--
-- Replace 8143c9a1-20f2-4881-a8d0-d10718f5d231 with the actual DMW event UUID before running.

-- ==========================================================
--  CHECK-IN BREAKDOWN FIX VERIFICATION
-- ==========================================================

-- 1. Raw check-in counts (ground truth)
-- ==========================================================
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE r.form_data->>'sex' = 'Male') AS male,
  count(*) FILTER (WHERE r.form_data->>'sex' = 'Female') AS female,
  count(*) FILTER (WHERE r.form_data->>'sex' IS NULL OR r.form_data->>'sex' NOT IN ('Male', 'Female')) AS unspecified,
  count(*) FILTER (WHERE r.form_data->>'pwd' = 'Yes') AS pwd,
  count(*) FILTER (WHERE lower(r.form_data->>'first_time_job_seeker') = 'yes') AS first_time,
  count(*) FILTER (WHERE lower(r.form_data->>'returning_ofw') = 'yes') AS ofw,
  count(*) FILTER (WHERE lower(r.form_data->>'returning_worker') = 'yes') AS returning_worker,
  count(*) FILTER (WHERE r.form_data->>'interested_in_skills_training' = 'Yes') AS skills_training,
  count(*) FILTER (WHERE r.entry_source = 'post_event_walk_in') AS walk_in,
  count(*) FILTER (WHERE public.parse_date_safe(r.form_data->>'date_of_birth') IS NOT NULL
                    AND extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30) AS youth
FROM public.check_ins ci
JOIN public.registrations r ON r.id = ci.registration_id
WHERE ci.event_id = '8143c9a1-20f2-4881-a8d0-d10718f5d231'
  AND ci.status = 'success';

-- 2. RPC output
-- ==========================================================
SELECT public.admin_event_category_breakdown('8143c9a1-20f2-4881-a8d0-d10718f5d231');

-- 3. Cross-event records (the 6 that were previously excluded)
-- ==========================================================
SELECT count(*) AS cross_event_count
FROM public.check_ins ci
JOIN public.registrations r ON r.id = ci.registration_id
WHERE ci.event_id = '8143c9a1-20f2-4881-a8d0-d10718f5d231'
  AND ci.status = 'success'
  AND r.event_id != ci.event_id;

-- 4. Per-check-in-category cross-event breakdown
-- ==========================================================
SELECT
  r.form_data->>'sex' AS gender,
  count(*) AS cnt
FROM public.check_ins ci
JOIN public.registrations r ON r.id = ci.registration_id
WHERE ci.event_id = '8143c9a1-20f2-4881-a8d0-d10718f5d231'
  AND ci.status = 'success'
  AND r.event_id != ci.event_id
GROUP BY r.form_data->>'sex'
ORDER BY cnt DESC;
