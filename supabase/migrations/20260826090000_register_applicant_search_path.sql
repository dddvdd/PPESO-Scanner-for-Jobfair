-- ============================================================================
-- Migration 004 — register_applicant search-path correction
--
-- pgcrypto (gen_random_bytes) is installed in the "extensions" schema on this
-- project, but the SECURITY DEFINER function register_applicant resolves
-- unqualified calls with search_path = public only, so ticket token
-- generation fails with:
--   function gen_random_bytes(integer) does not exist
--
-- This migration changes ONLY that function's runtime search path. The
-- function body, signature, arguments, privileges, and all registration
-- business logic are intentionally untouched.
-- ============================================================================

alter function public.register_applicant(uuid, uuid, text, text, text, text, text, text, jsonb)
set search_path = public, extensions;
