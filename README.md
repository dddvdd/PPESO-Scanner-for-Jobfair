# PPESO Job Fairs & Recruitment Events

> **Provincial Public Employment Service Office (PPESO) — Cagayan**  
> Web platform for job fair and recruitment event registration, QR ticket issuance, mobile check-in scanning, walk-in recording, vacancy management, and interview outcome tracking.

---

## ⚡ Overview

- **Jobseekers (Public):** Browse active in-person and online events, view 3-day local weather forecasts for in-person venues, submit registration forms (including position selection for online events), and receive a downloadable/screenshottable QR ticket.
- **Event Staff (`/staff/*`):** Scan QR tickets via mobile browser camera, search registrants and perform manual or early check-ins, complete missing registrant profile fields at the check-in checkpoint, record same-day or post-event walk-in applicants, and log company interview results (`HOTS`, `Near Hires`, `Qualified`, `Not Qualified`).
- **Municipal Scanners:** Optional municipality-scoped staff accounts (`29` municipalities/city in Cagayan) that are restricted by Row Level Security (RLS) and database RPCs to events assigned to their municipality, with mandatory password replacement on first login.
- **Administrators (`/admin/*`):** Create and manage in-person or online events (single-day or multi-day date ranges), assign municipalities, upload company job vacancies via CSV, view live demographic/category breakdowns and interview summaries, manage registrants, record audited late check-ins, export CSV reports, send one-time registration data correction links via email, and manage staff/admin accounts.

---

## 📁 Repository Layout

```text
src/
  assets/        PESO seal and empty-events illustrations
  components/    Shared UI controls, address comboboxes, date-range picker, QR & form renderers
  context/       Authentication and role/municipality session state (AuthContext)
  lib/           Supabase client, API wrappers, CSV parsers/exporters, PSGC address & weather helpers
  pages/         Public, staff, and administrator screens
  styles/        Shared dark institutional UI stylesheet (glass.css)
supabase/
  functions/     Edge Functions (event-weather, send-registration-corrections, resend-registration-correction-webhook)
  migrations/    Ordered PostgreSQL schema, RPC, and RLS migrations
  db_set-up_schema.sql   Base bootstrap schema for new databases
  weather-schedule.sql   pg_cron job definition for scheduled weather cache refreshes
scripts/
  validate-config-safety.mjs   Checks tracked files for leaked secrets or private artifacts
  validate-migrations.mjs      Static verification of SQL migrations and RLS hygiene
  validate-scope.mjs           Verifies MVP scope documentation sections
docs/
  setup.md                     Quick-start setup and deployment guide
  municipal-scanner-setup.md   Provisioning and scoping guide for the 29 municipal scanners
  mvp_scope.md                 Core architectural and security specification
  brand-spec.md                Visual design and branding guidelines
```

Start with [setup notes](docs/setup.md), [municipal scanner setup](docs/municipal-scanner-setup.md), [project scope](docs/mvp_scope.md), or the [design direction](docs/brand-spec.md).  
Local test suites, verification fixtures, audit scripts, screenshots, account lists, generated builds, and credentials are excluded from version control via `.gitignore`.

---

## 🗺️ Application Routes

| Route | Access | Purpose |
|---|---|---|
| `/` or `/events` | Public | Active event picker (in-person and online events; hides past events based on ` Asia/Manila` date or `event_end_date`) |
| `/events/:eventId/register/:formId` | Public | Jobseeker registration form with PSGC address lookup, employment classification cards, and Data Privacy Act consent |
| `/registration/success` | Public | Post-registration confirmation screen with QR ticket card |
| `/registration-correction` | Public (Token) | One-time link screen for preregistrants to fill in missing demographic/reporting fields |
| `/staff/login` | Public | Staff and administrator sign-in |
| `/staff/account` | Staff / Admin | Password update screen (enforced on first login for temporary municipal scanner passwords) |
| `/staff/scanner` | Staff / Admin | Mobile camera QR scanner, registrant lookup (current/upcoming vs. past events), profile completion checkpoint, early check-in, and admin late check-in |
| `/staff/interviews` | Staff / Admin | Shared real-time interview outcome tracker (`Not Qualified`, `Qualified`, `Near Hires`, `HOTS`) and interview CSV export |
| `/staff/walk-ins` | Staff / Admin | Walk-in applicant registration and attendance recording for events held today or within the previous 5 days |
| `/admin` | Admin | Admin Console with **Events** (create/edit, category & interview summary tables), **Export** (CSV downloads & correction email campaigns), and **Staff roles** tabs |
| `/admin/events/:eventId/registrants` | Admin | Searchable, filterable registrant directory and check-in manager for a specific event |
| `/admin/vacancies/:eventId?` | Admin | CSV batch uploader and viewer for event company job vacancies |

---

## 📋 Prerequisites

| Requirement | Where to get it | Notes |
|---|---|---|
| **Git** | [git-scm.com](https://git-scm.com) | Version control |
| **Node.js** | [nodejs.org](https://nodejs.org) | v20.19+ or v22.12+ recommended |
| **Supabase Project** | [supabase.com](https://supabase.com) | PostgreSQL database, Auth, RLS, and optional Edge Functions |

---

## 🚀 Step-by-Step Setup

### Step 1 — Clone and install dependencies

```bash
git clone https://github.com/dddvdd/PPESO-Scanner-for-Jobfair.git
cd PPESO-Scanner-for-Jobfair
npm install
```

### Step 2 — Create your Supabase project and get API credentials

1. Sign in to [supabase.com](https://supabase.com) and click **New Project**.
2. Once the project is ready, open **Project Settings ⚙️ → API**.
3. Copy your **Project URL** (`https://YOUR_PROJECT_REF.supabase.co`) and **anon public** key.

### Step 3 — Configure `.env`

Copy `.env.example` to `.env` in the repository root:

**Windows (PowerShell):**
```powershell
copy .env.example .env
```

**macOS / Linux:**
```bash
cp .env.example .env
```

Fill in your public Supabase credentials in `.env`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> ⚠️ **Security Note:** Never place `service_role` keys, database passwords, or third-party API secrets in `.env` or any `VITE_*` variable. `.env` is ignored by Git.

### Step 4 — Apply database migrations

Open **Supabase Dashboard → SQL Editor** (or use the Supabase CLI) and apply the SQL files in `supabase/migrations/` in chronological order:

1. **Core schema, RPCs, and RLS (`20260825*` – `20260826*`):**
   - `20260825090000_core_schema.sql` — Core tables (`events`, `forms`, `form_fields`, `registrations`, `check_ins`, `profiles`)
   - `20260825090100_functions_rpcs.sql` — Core RPCs (`register_applicant`, `retrieve_ticket`, `perform_check_in`, `staff_lookup`)
   - `20260825090200_rls_policies.sql` — Row Level Security policies
   - `20260826090000_register_applicant_search_path.sql` through `20260826220000_admin_delete_user.sql` — Privilege hardening, token guards, event-date check-in guards, seeded standard form fields, and admin user management RPCs
2. **Interviews, Vacancies, Walk-ins, and Admin Breakdowns (`20260908*` – `20260930*`):**
   - `20260908022812_staff_interview_status.sql` & `20260914002841_shared_interview_results.sql` — Shared interview outcome tracking
   - `20260908095149_add_vacancies.sql` & `20260912020000_staff_event_vacancies.sql` — Event company vacancies and staff autocomplete lookup
   - `20260912003654_fix_staff_lookup_manual_check_in.sql` & `20260912004338_admin_audited_late_check_in.sql` — Manual and audited late check-ins
   - `20260912005311_staff_post_event_walk_ins.sql`, `20260912010503_walk_in_event_registration_forms.sql`, `20260913010000_relax_walk_in_validation.sql`, `20260925042459_allow_same_day_walk_ins.sql` — Same-day and post-event walk-in registration & check-in
   - `20260913000000_admin_event_category_breakdown.sql` through `20260930090000_interview_export_profile_fields.sql` — Category/sex/youth breakdowns, multi-event check-in scoping, and interview export fields
3. **Profile Completeness, Correction Links, Weather, and Classifications (`20261007*` – `20261016*`):**
   - `20261007120000_seed_standard_fields_for_published_forms.sql` & `20261007130000_require_registration_identity_fields.sql`
   - `20261007140000_registration_data_correction_links.sql` & `20261007150000_registration_correction_email_tracking.sql` — Single-use 7-day correction links and Resend delivery status tracking
   - `20261007160000_scanner_missing_profile_checkpoint.sql` — Scanner checkpoint for completing blank demographic fields at check-in
   - `20261008090000_shared_event_weather.sql`, `20261008093000_event_weather_feels_like.sql`, `20261008094500_event_weather_condition_label.sql` — Shared event weather cache
   - `20261016120000_add_employment_classification_fields.sql` — Additional employment status classifications
4. **Municipal Scanners, Online Events, and Date Ranges (`20261104*` – `20261106*`):**
   - `20261104090000_municipal_scanner_accounts.sql` — Municipality scoping, first-login password enforcement, and provisioning for 29 municipal scanner accounts
   - `20261106150000_online_events.sql` — Online recruitment events (`is_online`) and `position_applying_for` field management
   - `20261106160000_event_date_ranges.sql` — Multi-day event support (`event_end_date`) across registration, check-in, and walk-in flows

### Step 5 — Create your first Admin account & disable public sign-ups

1. In **Supabase Dashboard → Authentication → Users**, click **Add user → Create new user** (enable **Auto Confirm User**).
2. Promote the user to `admin` in **SQL Editor**:
   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@yourorganization.gov.ph');
   ```
3. Disable public sign-ups in **Authentication → Providers → Email** by turning **OFF** *"Enable sign up"* and saving.
4. Additional staff, supervisor, admin, or municipal scanner accounts can be created directly inside the web app under **Admin (`/admin`) → Staff roles**.

### Step 6 — Run the application locally

```bash
npm run dev
```

Open `http://localhost:5173`. To test mobile camera scanning over LAN with HTTPS:

```powershell
$env:SEP11_HTTPS = "1"; npm run dev
```

---

## 🛠️ Scripts & Validation Commands

Run commands from the repository root:

```bash
npm run dev                  # Start Vite development server
npm run build                # Build production bundle to dist/
npm run preview              # Preview production build locally
npm run validate:config      # Verify no secrets, keys, or test artifacts are tracked in Git
npm run validate:migrations  # Static check of SQL migrations, constraints, RPCs, and RLS rules
npm run validate:scope       # Verify docs/mvp_scope.md contains all required specification sections
```

---

## 🏛️ Municipal Scanner Accounts (29 Municipalities / City)

Administrators can provision 29 dedicated scanner accounts covering all municipalities and Tuguegarao City in Cagayan. Distribute account details privately.

1. Sign in to `/admin` and open the **Staff roles** tab.
2. Under **Municipal scanner accounts**, enter a temporary password (minimum 6 characters) and click **Create 29 municipal scanners**. Existing accounts are skipped without altering their passwords or assignments.
3. When creating or editing an event under **Events**, select its **Municipality / City**.
4. Municipal scanners only see events assigned to their municipality. Unassigned events are visible only to administrators and general (unassigned) staff.
5. On first sign-in at `/staff/login`, municipal scanners are redirected to `/staff/account` and must replace their temporary password with a new password (minimum 8 characters) before accessing any staff tools.

See [docs/municipal-scanner-setup.md](docs/municipal-scanner-setup.md) for full details.

---

## ✉️ Registration Data Correction Links (Resend)

Administrators can send one-time correction links to preregistrants who have blank reporting answers (Date of Birth, Highest Educational Attainment, PWD, Sex, First-time Job Seeker, Returning OFW, Returning Worker, Interested in Skills Training, Province, Municipality/City, and Barangay). Links expire after 7 days, are single-use, and only allow filling fields that were blank when issued.

### Configure and deploy

1. Ensure `20261007140000_registration_data_correction_links.sql` and `20261007150000_registration_correction_email_tracking.sql` are applied.
2. Verify your sender domain in [Resend](https://resend.com).
3. In **Supabase Dashboard → Edge Functions → Secrets**, configure:
   - `RESEND_API_KEY` — Resend API key
   - `RESEND_FROM_EMAIL` — Verified sender address (e.g., `PESO <no-reply@example.gov.ph>`)
   - `APP_BASE_URL` — Public HTTPS origin where the frontend is deployed (no trailing slash)
   - `RESEND_WEBHOOK_SECRET` — Signing secret for the Resend webhook endpoint
4. In Resend, create a webhook pointing to:
   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/resend-registration-correction-webhook
   ```
   Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, `email.failed`, and `email.suppressed`.
5. Deploy both Edge Functions:
   ```powershell
   supabase functions deploy send-registration-corrections --project-ref YOUR_PROJECT_REF
   supabase functions deploy resend-registration-correction-webhook --project-ref YOUR_PROJECT_REF
   ```
6. In **Admin (`/admin`) → Export**, select an event, click **Preview affected preregistrants**, and then **Send correction emails**. Use **Refresh email status** to view delivery tracking.

---

## 🌤️ Shared Google Event Weather Forecasts

In-person event cards on the public landing page display a forecast icon, condition label (`Sunny`, `Cloudy`, `Rainy`, `Heavy rain`, `Windy`, `Thunderstorm`), and daily maximum "feels like" temperature in `°C` using the `event-weather` Edge Function and a shared Supabase cache. Online events (`is_online = true`) automatically skip weather fetching.

- **Eligibility:** Public in-person events from today through the next two `Asia/Manila` dates.
- **Refresh schedule:** Future-event forecasts refresh at Manila midnight; same-day event forecasts refresh every 3 hours (`00:00`, `03:00`, `06:00`, etc.). Past events stop refreshing.
- **Deduplication & lease:** Normalized `(location, event_date)` pairs share one Google Weather API fetch guarded by an atomic database lease.

### Configure and deploy

1. Apply `20261008090000_shared_event_weather.sql`, `20261008093000_event_weather_feels_like.sql`, and `20261008094500_event_weather_condition_label.sql`.
2. Enable the Google Weather API and add `GOOGLE_WEATHER_API_KEY` in **Supabase Dashboard → Edge Functions → Secrets**.
3. Deploy the Edge Function:
   ```powershell
   supabase functions deploy event-weather --project-ref YOUR_PROJECT_REF
   ```
4. Store your project's public anon key in Supabase Vault as `weather_anon_key`, replace the project URL placeholder in `supabase/weather-schedule.sql`, and run it in the SQL Editor to configure the scheduled `pg_cron` refresh and cleanup jobs.

---

## 📊 Link Supabase Data to Excel

In addition to built-in CSV exports (**Pre-registrants**, **Check-ins**, and **Interview Results**), you can connect Excel directly to your Supabase PostgreSQL database:

1. In **Supabase Dashboard → Project Settings ⚙️ → Database → Connection string (URI)**, locate your host and database password.
2. In Excel, go to **Data → Get Data → From Database → From PostgreSQL Database**.
3. Enter server `db.YOUR_PROJECT_REF.supabase.co,5432` and database `postgres`, then authenticate as user `postgres`.
4. Load tables such as `registrations`, `check_ins`, `interview_results`, `vacancies`, and `events`.

> ⚠️ **Security Note:** Excel stores database credentials inside the workbook connection. Remove the connection (**Data → Queries & Connections → Delete**) before sharing `.xlsx` files.

---

## ❓ Troubleshooting

| Symptom | Resolution |
|---|---|
| `Supabase is not configured` | Ensure `.env` has valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values and restart `npm run dev`. |
| Camera won't start on scanner | Camera access requires HTTPS or `localhost`. Check browser site permissions (padlock icon → Camera → Allow) or run with `$env:SEP11_HTTPS = "1"; npm run dev`. |
| Event not showing on scanner / staff pages | If signed in with a municipal scanner account, verify the event's **Municipality / City** matches the scanner's assigned municipality and that the temporary password has been changed. |
| Check-in blocked with missing profile fields | Complete the prompted demographic fields on the scanner screen and click **Save and continue check-in**. |
| Past event check-in blocked | Standard check-ins are restricted after the event's end date (`coalesce(event_end_date, event_date)`). Administrators can record an audited **Late check-in** with a reason from `/staff/scanner`, or staff can record **Walk-in applicants** at `/staff/walk-ins` for events held within the past 5 days. |

---

## 🔒 Security Principles

- **Row Level Security (RLS):** Enabled on all tables in schema `public`. Anonymous clients cannot read, update, or delete registrations directly; all public and staff operations go through validated `SECURITY DEFINER` / `SECURITY INVOKER` RPCs.
- **Opaque QR Tokens:** QR codes encode only a 48-character random hex `ticket_token` — never personal identifiable information (PII).
- **Atomic Check-Ins:** A partial unique index (`check_ins_one_success_per_registration`) and `ON CONFLICT DO NOTHING` guarantee a registration can never be checked in twice, even under simultaneous scans.
- **Strict Secret Isolation:** `service_role` keys, database connection strings, and third-party API keys (`RESEND_API_KEY`, `GOOGLE_WEATHER_API_KEY`) live exclusively in server-side Supabase Edge Function secrets.
