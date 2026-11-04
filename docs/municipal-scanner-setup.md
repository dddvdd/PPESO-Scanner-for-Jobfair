# Municipal scanner setup

This change prepares 29 scanner accounts. The account list is in
[municipal-scanner-accounts.csv](municipal-scanner-accounts.csv).
It does not create live users until the migration and provisioning step run.

1. Apply `supabase/migrations/20261104090000_municipal_scanner_accounts.sql`
   after the existing migrations, and deploy the updated frontend together.
2. Sign in as an administrator. Under **Admin → Staff roles**, enter the
   operator's requested temporary password and select **Create 29 municipal scanners**.
   The temporary password is supplied at runtime and is never stored in source
   or returned in the setup result. Check the per-account results. Existing
   email addresses are skipped without changing their passwords or access.
3. Edit each event and select its **Municipality / City**. Existing events
   remain unassigned until an administrator classifies them; venue text is
   not used to guess access. Municipal scanners cannot see unassigned events.
4. Give each municipality its email and temporary password. At `/staff/login`,
   the scanner must replace the temporary password with a different password
   of at least eight characters before scanning or viewing operational data.

Municipal restrictions apply in database policies and RPCs to events, forms,
ticket searches, check-ins, profile completion, walk-ins, vacancies, interviews,
and interview exports. Existing administrators and unassigned general staff
retain their access. Public registration remains available anonymously.
Assignments and first-login enforcement come from protected profile columns,
not editable user metadata. Password verification and the first password
replacement happen atomically on the server.

## Local verification

- `npm run build`
- `npm run validate:migrations`
- `node scripts/verify/municipal-scanner-ui.mjs` starts a temporary loopback
  Vite server and mocks all Auth/Data API responses. It checks redirects,
  persisted first-login enforcement, password change, scanner access, setup,
  and municipality selection. It does not test a live Supabase Auth service.
- `node scripts/verify/municipal-scanners.test.mjs` expects an isolated local
  PostgreSQL instance at `127.0.0.1:55439` with a local `postgres` user. It creates
  a uniquely named test database with minimal Auth tables, applies all
  migrations, and checks actual policies and RPCs for every municipality.
  It never reads `.env` or contacts external services.

The repository's `validate:config` currently also scans the pre-existing,
untracked `.agents` skill folder and reports embedded demo configuration there.
The dependency audit requires an outbound network request and is not run under
the repository's local-only rule.
