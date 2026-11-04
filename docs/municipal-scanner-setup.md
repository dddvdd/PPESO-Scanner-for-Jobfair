# Municipal scanner setup

This change prepares 29 scanner accounts. Distribute account details privately.
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
- `npm run validate:config`

Test suites and account lists are kept locally and excluded from the published repository.
