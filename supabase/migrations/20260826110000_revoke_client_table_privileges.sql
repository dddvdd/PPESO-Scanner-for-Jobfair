-- ============================================================================
-- Migration 005 — P0 privilege hardening (Phase 2F audit finding F1)
--
-- Supabase default grants give anon/authenticated far more than the HTTP API
-- can use. Row Level Security is the boundary for row DML/SELECT, but
-- TRUNCATE bypasses row-level security entirely and REFERENCES/TRIGGER have
-- no legitimate client use in this application.
--
-- This migration revokes ONLY those three table privileges from the two
-- client roles on every table in the public schema:
--   TRUNCATE, REFERENCES, TRIGGER
--
-- Intentionally unchanged:
--   - SELECT/INSERT/UPDATE/DELETE grants (RLS remains the row-level boundary)
--   - service_role / postgres / dashboard_user privileges
--   - RPC definitions, authorization logic, RLS policies, data
-- ============================================================================

revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
