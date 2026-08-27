-- ============================================================================
-- Migration 010 — Seed standard PESO registration form fields
--
-- Adds the standard analysis-trigger fields to every published form.
-- These fields are stored in form_data JSONB and used for reporting/analysis.
--
-- Identity fields (first_name, last_name, email, mobile_number) are stored
-- separately in the registrations table but are ALSO included as form_fields
-- so they appear in form_data for unified CSV export.
-- ============================================================================

DO $$
DECLARE
  rec RECORD;
  form_id uuid;
  sort integer := 0;
BEGIN
  -- Iterate over all published forms
  FOR rec IN
    SELECT id, event_id
    FROM public.forms
    WHERE status = 'published'
    ORDER BY created_at
  LOOP
    form_id := rec.id;
    sort := 0;

    -- 1. Last Name
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'last_name', 'Last Name', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 2. First Name
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'first_name', 'First Name', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 3. Middle Name
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'middle_name', 'Middle Name', 'short_text', false, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 4. Date of Birth
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'date_of_birth', 'Date of Birth', 'date', false, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 5. Course
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'course', 'Course', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 6. Contact Number (mobile)
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'contact_number', 'Contact Number', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 7. Email Address
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'email_address', 'Email Address', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 8. PWD
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'pwd', 'PWD', 'radio', false, '["Yes", "No"]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 9. Sex
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'sex', 'Sex', 'radio', true, '["Male", "Female", "Prefer not to say"]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 10. First Time Job Seeker
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'first_time_job_seeker', 'FIRST TIME JOB SEEKER', 'yes_no', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 11. Returning OFW
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'returning_ofw', 'RETURNING OFW', 'yes_no', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 12. Returning Worker
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'returning_worker', 'RETURNING WORKER', 'yes_no', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 13. Interested in Skills Training
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'interested_in_skills_training', 'INTERESTED IN SKILLS TRAINING', 'radio', false, '["Yes", "No"]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 14. Province (for analysis)
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'province', 'Province', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 15. Municipality / City (for analysis)
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'municipality_city', 'Municipality/City', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

    -- 16. Barangay (for analysis)
    INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
    VALUES (form_id, 'barangay', 'Barangay', 'short_text', true, '[]'::jsonb, sort)
    ON CONFLICT (form_id, field_key) DO NOTHING;
    sort := sort + 1;

  END LOOP;

  RAISE NOTICE 'Migration 010: seeded PESO registration fields into all published forms.';
END $$;
