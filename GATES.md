# GATES — Greenfield Foundation Phase (mvp_scope.md Phase 1)

Ledger authored by ox-alpha. All CHECK commands below were written in this session.
NOTE: the unlazy helper scripts (gate-lint.mjs / gate-check.mjs) are not installed in this
environment; checks are executed directly and evidence (exit code + decisive output token)
is recorded in the implementation report.

Remote Supabase application is intentionally out of gate scope: no credentials exist
(SAFETY GATE). It is reported as NOT TESTED, not abandoned work.

---

## G1: mvp_scope.md contains every section required by the owner task

CHECK: node scripts/validate-scope.mjs
EXPECT: SCOPE_COMPLETE

## G2: Project installs cleanly and Vite production build succeeds

Precondition (setup, not a gate): `npm install`
CHECK: npm run build
EXPECT: built in

## G3: No secrets or unsafe configuration exist in the repository

CHECK: node scripts/validate-config-safety.mjs
EXPECT: CONFIG_SAFE

## G4: Local migrations implement schema, integrity, RLS design, and atomic check-in

CHECK: node scripts/validate-migrations.mjs
EXPECT: MIGRATIONS_VALID

---

# Phase 1.5 — Remote Supabase Verification

Remote gates require owner-provided configuration. Until `.env` carries
VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, every remote gate is BLOCKED,
not failed. Secrets are supplied via session environment variables only
(SUPABASE_DB_URL, SUPABASE_SERVICE_KEY) so no secret ever touches disk.

## P15-G0: Verification harness scripts are syntactically valid

CHECK: npm run verify:selfcheck
EXPECT: SYNTAX_OK

## P15-G1: Local Supabase configuration is present

CHECK: npm run verify:env
EXPECT: CONFIG_PRESENT

## P15-G2: Configured Supabase project is reachable

CHECK: npm run verify:connect
EXPECT: REACHABLE

## P15-G3: The three migrations apply cleanly in order

CHECK: npm run verify:migrate
EXPECT: MIGRATIONS_APPLIED

## P15-G4: Expected database objects exist remotely (incl. RLS enabled)

CHECK: npm run verify:objects
EXPECT: OBJECTS_VERIFIED

## P15-G5: Policy catalog matches the security model

CHECK: npm run verify:policies
EXPECT: POLICIES_VERIFIED

## P15-G6: RPC matrix passes (register/retrieve/check-in/atomic/race/RLS behavior)

CHECK: npm run verify:rpc
EXPECT: RPC_TESTS_PASSED

## P15-G7: Database integrity constraints reject invalid data

CHECK: npm run verify:integrity
EXPECT: INTEGRITY_TESTS_PASSED
