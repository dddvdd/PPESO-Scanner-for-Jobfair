# Set-Up Guide — Job Fair Registration & QR Check-In

Short version: **1 SQL file + 2 keys + 1 admin user = working system.**
Do the parts in order. Each step is one action.

---

## PART 0 — You need these first

- [ ] A browser
- [ ] Node.js installed (`node -v` prints something)
- [ ] A free Supabase account (supabase.com)

---

## PART 1 — Create the database (~10 min)

### Step 1. Create a Supabase project
- [ ] supabase.com → **New project** → pick any name/region → set a DB password (save it)

Wait until the project says **Active**.

### Step 2. Run the master SQL file (ONE file, ONE time)
- [ ] In Supabase: left sidebar → **SQL Editor** → **New query**
- [ ] Open `supabase/db_set-up_schema.sql` from this repo
- [ ] Copy its ENTIRE contents → paste into the editor → **Run**

> [!IMPORTANT]
> Run it ONCE only, on an EMPTY/new project. Never on a database that already has tables.

**You should see:** "Success. No rows returned."

Done. Tables, security rules, and all logic now exist.

### Step 3. Create your admin account
- [ ] Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**
- [ ] Enter your email + password → check **Auto Confirm User** → **Create user**

### Step 4. Make yourself admin
- [ ] **SQL Editor** → new query → paste this (replace the email) → **Run**:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

**You should see:** "Success. 1 row affected."

(To add staff later: same query with `role = 'staff'`.)

### Step 5. Lock the door
- [ ] **Authentication** → **Sign In / Providers** → turn OFF **Allow new users to sign up** → Save

---

## PART 2 — Connect the app (~5 min)

### Step 6. Copy your two keys
- [ ] **Project Settings** (gear icon) → **API**
- [ ] Copy **Project URL** and the **anon public** key

The anon key is safe to expose. NEVER use the service-role key in this app.

### Step 7. Put them in `.env`
- [ ] Repo root → copy `.env.example` to `.env` → fill in:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Step 8. Install & run
```bash
npm install
npm run dev
```

- [ ] Open the printed localhost URL

**You should see:** dark glassy page saying "Job Fair Registration".

---

## PART 3 — Use it

### Applicant: register + get ticket
1. Open the site → **Events** → pick event → **Register**
2. Fill the form → **Submit registration**
3. QR ticket appears → screenshot/save it

Lost ticket? **Retrieve ticket** → enter email (registration number optional).

### Staff: scan tickets at the door
1. Go to `/staff/login` → sign in with a staff/admin account
2. Allow camera when the browser asks
3. Point at the attendee's QR → big green result = checked in

Scanning another code while a result is showing? Tap **Scan Again** first.
Need a break? Tap the **pause button** (top-right of camera) — resume anytime.

### Testing the scanner on a PHONE (not just laptop)
Camera needs HTTPS. From the repo root:

```bash
# PowerShell
$env:SEP11_HTTPS = "1"; npm run dev

# then open https://<your-lan-ip>:5173 on the phone
# accept the self-signed-certificate warning once
```

---

## PART 4 — Something broke?

| Symptom | Fix |
| --- | --- |
| Blank page / no data | `.env` values wrong → recheck Step 6–7, restart `npm run dev` |
| "Secure connection required" on scanner | Use the HTTPS command from Part 3 |
| Camera permission blocked | Browser address bar → padlock → Permissions → Camera → Allow → tap Scan Again |
| "Already checked in" | Not an error — attendee scanned twice; shows original time |
| "Not authorized" after login | Your profile role isn't staff/admin → redo Step 4 |
| Want to double-check the database | Supabase → Table Editor → look at `registrations` / `check_ins` |

---

## File map (when you care later)

| File | Why it exists |
| --- | --- |
| `supabase/db_set-up_schema.sql` | THE master SQL — fresh install, run once (Step 2) |
| `supabase/migrations/` | Same changes split into 6 ordered files — for projects that already exist |
| `.env` | Your two keys (never commit) |
| `vercel.json` | Deploy config — SPA routing + camera permission header |
| `README.md` / `mvp_scope.md` | Deep details / full spec |

---

## PART 5 — Put it online (Vercel, ~10 min)

The backend is ALREADY online (Supabase). Only the frontend gets deployed —
it becomes a static site; HTTPS is automatic.

### Step 1. Recommended: separate prod database
- [ ] Create a SECOND Supabase project → run Part 1 Steps 2–5 on it
- [ ] Use its URL/key for the live site; keep the current one for testing

Skipping this works too — the live site would just share your test data.

### Step 2. Push this folder to GitHub
- [ ] Create an empty repo on github.com
- [ ] From the project root:

```bash
git init
git add .
git commit -m "Job fair registration app"
git remote add origin https://github.com/YOU/REPO.git
git push -u origin main
```

`.env` is gitignored automatically — good, keys never upload.

### Step 3. Import to Vercel
- [ ] vercel.com → sign in with GitHub → **Add New Project** → import your repo
- [ ] Framework Preset: it auto-detects **Vite** — leave everything default
- [ ] Open **Environment Variables** → add exactly these two:

```
VITE_SUPABASE_URL      = https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY = sb_publishable_... or anon key
```

- [ ] **Deploy** → wait ~1 min

**You should see:** a live URL like `https://your-app.vercel.app` — open it
on your phone and the scanner works with no extra setup (HTTPS included).

### Every future update

```bash
git add . && git commit -m "update" && git push
```

Vercel redeploys automatically. Done.
