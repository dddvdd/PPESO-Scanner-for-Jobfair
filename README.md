# Job Fair Registration & QR Check-In System (MVP)

> PESO Cagayan — Job Fair management tool

## ⚡ 60-second overview

**What this is:** A web app for a Job Fair event.

- Job seekers → register, get a QR ticket
- Staff → scan QR codes or manually check people in
- Admin → manage events, forms, and see attendance

**Time to first run:** ~10 minutes (if you have a Supabase project ready)

---

## 📋 Before you start

| What you need | Where to get it | Time |
|---|---|---|
| **Git** installed | [git-scm.com](https://git-scm.com) | 2 min |
| **Node.js** (v18+) | [nodejs.org](https://nodejs.org) | 3 min |
| **A Supabase account** | [supabase.com](https://supabase.com) → free tier | 3 min |

Check each one ✓ when you have it:

- [ ] I can run `git --version` in a terminal
- [ ] I can run `node --version` and it shows v18 or higher
- [ ] I can log in to [supabase.com](https://supabase.com)

---

## 🚀 Step-by-step: from zero to running app

### Step 1 — Download the project

Open a terminal (PowerShell on Windows, Terminal on Mac) and run:

```bash
git clone https://github.com/YOUR_ORG/jobfair-registration-mvp.git
cd jobfair-registration-mvp
```

**✅ Done when:** You can see files when you run `ls` (or `dir` on Windows).

---

### Step 2 — Install the dependencies

```bash
npm install
```

Wait for it to finish. You'll see `added X packages` in the output.

**✅ Done when:** A `node_modules` folder appears in your project.

---

### Step 3 — Create your Supabase project (skip if you already have one)

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in:
   - **Organization:** pick yours
   - **Name:** `JobFair-MVP` (or whatever you like)
   - **Database Password:** type a strong password — **write it down**
   - **Region:** pick the closest one to you
4. Click **"Create new project"**
5. Wait ~30 seconds until it says **"Your project is ready"**

**✅ Done when:** You're on your project's dashboard page.

---

### Step 4 — Get your Supabase credentials

In your Supabase dashboard:

1. Click the **gear icon ⚙️** (Project Settings) in the sidebar
2. Click **API** in the left menu
3. Copy these two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (starts with `eyJ...` or `sb_publishable_...`)

**✅ Done when:** You have both values copied to your clipboard.

---

### Step 5 — Set up the environment file

In your project folder, find `.env.example`. Make a copy called `.env`:

**Windows (PowerShell):**
```powershell
copy .env.example .env
```

**Mac / Linux:**
```bash
cp .env.example .env
```

Now open `.env` in any text editor and paste your values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**⚠️ IMPORTANT:** Never share your `.env` file. It has your project credentials. It is already in `.gitignore` so it won't get pushed to GitHub.

**✅ Done when:** `.env` exists and has both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` filled in.

---

### Step 6 — Run the database migrations

This creates all the tables, functions, and security rules in your Supabase project.

**Option A — Supabase Dashboard (easiest):**
1. In Supabase dashboard, click **SQL Editor**
2. Click **"New query"**
3. Open each file in `supabase/migrations/` in order (the numbers tell you the order)
4. Copy and paste each SQL file's content into the editor and click **"Run"**

Files to run in this order:
1. `20260825090000_core_schema.sql`
2. `20260825090100_functions_rpcs.sql`
3. `20260825090200_rls_policies.sql`
4. `20260826090000_register_applicant_search_path.sql`
5. `20260826110000_revoke_client_table_privileges.sql`
6. `20260826120000_retrieve_ticket_email_lookup.sql`
7. `20260826130000_retrieve_ticket_token_guard.sql`
8. `20260826140000_staff_lookup_ticket_token.sql`
9. `20260826150000_check_in_event_date_guard.sql`

**Option B — Command line (if you have DB access):**
```bash
# Set this in your terminal BEFORE running npm:
# Windows PowerShell:
$env:SUPABASE_DB_URL = "postgresql://postgres:YOUR_PASSWORD@db.xxxxxx.supabase.co:5432/postgres"

# Then:
npm run verify:migrate
```

**✅ Done when:** You can see tables (`registrations`, `events`, `check_ins`, etc.) in Supabase Dashboard → **Table Editor**.

---

### Step 7 — Create your admin account

1. In Supabase dashboard, go to **Authentication → Users**
2. Click **"Add user"**
3. Fill in:
   - **Email:** `admin@yourorganization.gov.ph` (or whatever you want)
   - **Password:** choose a strong password
   - **Auto Confirm User:** toggle ON
4. Click **"Create user"**
5. Then open **SQL Editor** and run this (replace the UUID with the one shown after creating the user):

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = 'YOUR_AUTH_USER_UUID_HERE';
```

**✅ Done when:** The user exists and has `role = 'admin'` in the `profiles` table.

---

### Step 8 — Create a staff account

Repeat Step 7 but:
- Use a staff email like `staff@yourorganization.gov.ph`
- Set the role to `'staff'` instead of `'admin'`

**✅ Done when:** Staff account is created and promoted.

---

### Step 9 — Disable public sign-ups

1. Go to **Authentication → Providers → Email**
2. Turn **OFF** "Enable sign up"
3. Click **Save**

This prevents random people from creating accounts on your site.

**✅ Done when:** The toggle is OFF.

---

### Step 10 — Create your first event

You can do this two ways:

**Option A — SQL (fastest):**
```sql
INSERT INTO public.events (name, event_date, location, description, status)
VALUES (
  'PESO Job Fair 2026',
  CURRENT_DATE,
  'Cagayan Provincial Capitol, Tuguegarao City',
  'Annual job fair for the province',
  'published'
);
```

**Option B — Web UI (after starting the app):**
1. Start the app (Step 11)
2. Log in as admin
3. Go to the Admin page
4. Click "Create Event"

**✅ Done when:** You see your event in the Events table (or on the homepage).

---

### Step 11 — Start the app

```bash
npm run dev
```

A browser tab should open automatically. If it doesn't, go to:
```
http://localhost:5173
```

**✅ Done when:** You see the Job Fair homepage in your browser.

---

### Step 12 — Test the full flow

**As a job seeker (public):**
1. Go to http://localhost:5173
2. Click "Register" on your event
3. Fill in the form and submit
4. You'll see a confirmation screen with your QR code — **take a screenshot or print it**

**As staff (check-in):**
1. Go to http://localhost:5173/staff
2. Log in with your staff email + password
3. Point your camera at the QR code (or use Manual Search)
4. You should see "Check-in successful" ✓

**As admin:**
1. Go to http://localhost:5173/admin
2. Log in with your admin email + password
3. You should see all registrations and check-in data

**✅ Done when:** All three flows work end-to-end.

---

## 🔧 Useful commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview the production build locally
npm run validate:migrations  # Check all SQL files are valid
```

---

## ❓ Common problems

| Problem | Fix |
|---|---|
| `Supabase is not configured` error | Check that `.env` has both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| Can't scan QR code | Make sure you're on HTTPS or localhost. Camera won't work on plain HTTP. |
| "Event date mismatch" on check-in | The event's `event_date` must match today. Check the Events table in Supabase. |
| 403 Forbidden on check-in | Your user needs `role = 'staff'` in the `profiles` table |
| Blank page on load | Open browser DevTools (F12) → Console. Look for red error messages. |
| Camera won't start | Click the padlock icon in your browser's address bar → Permissions → allow Camera |

---

## 🔒 Security notes

- The `.env` file is **never** pushed to Git (it's in `.gitignore`)
- Staff can only check people in — they can't see or edit registration data directly
- Admin can manage everything
- All check-ins are logged with the staff member's ID and device identifier
- Ticket tokens are 48-character random strings — not predictable

---

## 📁 Project structure

```
src/
  pages/          # Main screens (Home, Register, StaffScanner, Admin)
  components/     # Reusable pieces (TicketCard, QR scanner, forms)
  lib/            # API calls, Supabase client, helpers
  styles/         # CSS (glassmorphism dark theme)

supabase/
  migrations/     # SQL files — run these to set up your database

scripts/
  verify/         # Migration and test scripts
  validate-*.mjs  # Static checks (don't need a database)
```

---

## 🆘 Need help?

- Check the browser console (F12) for errors
- Run `npm run validate:migrations` to check your SQL files
- Open an issue on GitHub with what went wrong
