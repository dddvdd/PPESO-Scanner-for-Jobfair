-- ============================================================================
-- Migration 010 — Seed standard PESO registration form fields
--
-- Adds the standard analysis-trigger fields to every published form.
-- These fields are stored in form_data JSONB and used for reporting/analysis.
--
-- NOTE: Identity fields (first_name, last_name, middle_name, email,
-- mobile_number) are NOT seeded here. They are captured by the hardcoded
-- core identity inputs on RegisterPage and stored in dedicated columns on
-- the registrations table, so seeding them as form_fields would render them
-- twice. The 11 fields below are the analysis-specific questions.
--
-- Plain SQL (no PL/pgSQL) so it runs reliably in the Supabase SQL Editor.
-- ============================================================================

INSERT INTO public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
SELECT
  f.id,
  v.field_key,
  v.label,
  v.field_type::field_type,
  v.required,
  v.options,
  v.sort_order
FROM public.forms f
CROSS JOIN (VALUES
  ('date_of_birth',                  'Date of Birth',                'date',       false, '[]'::jsonb,                                                                  0),
  ('course',                         'Course',                       'short_text', true,  '[]'::jsonb,                                                                  1),
  ('pwd',                            'PWD',                          'radio',      false, '["Yes", "No"]'::jsonb,                                                       2),
  ('sex',                            'Sex',                          'radio',      true,  '["Male", "Female", "Prefer not to say"]'::jsonb,                              3),
  ('first_time_job_seeker',          'FIRST TIME JOB SEEKER',        'yes_no',     true,  '[]'::jsonb,                                                                  4),
  ('returning_ofw',                  'RETURNING OFW',                'yes_no',     true,  '[]'::jsonb,                                                                  5),
  ('returning_worker',               'RETURNING WORKER',             'yes_no',     true,  '[]'::jsonb,                                                                  6),
  ('interested_in_skills_training',  'INTERESTED IN SKILLS TRAINING','radio',      false, '["Yes", "No"]'::jsonb,                                                      7),
  ('province',                       'Province',                     'short_text', true,  '[]'::jsonb,                                                                  8),
  ('municipality_city',              'Municipality/City',            'short_text', true,  '[]'::jsonb,                                                                  9),
  ('barangay',                       'Barangay',                     'short_text', true,  '[]'::jsonb,                                                                 10)
) AS v(field_key, label, field_type, required, options, sort_order)
WHERE f.status = 'published'
ON CONFLICT (form_id, field_key) DO NOTHING;
