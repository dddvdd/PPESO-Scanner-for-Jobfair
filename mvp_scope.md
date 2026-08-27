# Job Fair Registration & QR Check-In System — MVP Scope

## 1. Objective

Build a reliable, mobile-friendly job fair registration and event check-in system.

The MVP must allow:

1. An admin to create and publish registration forms.
2. Applicants to register through a public form.
3. The system to securely store registration data.
4. The system to generate a unique QR ticket after registration.
5. Applicants to retrieve/view their ticket later.
6. Staff to scan QR tickets using a mobile phone browser.
7. The system to prevent duplicate check-ins.
8. Admin/staff to search and retrieve registration records.
9. Admin to export registration/check-in data.

The MVP must prioritize **reliability, simplicity, mobile usability, data integrity, and low operating cost**.

---

# 2. Required Technology

## Frontend

Use the existing React/Vite frontend if it is reusable.

Do not rewrite the entire frontend unnecessarily.

## Backend

Use **Supabase** as the primary backend.

Use:

* Supabase PostgreSQL
* Supabase Auth for administrative/staff accounts
* Supabase Row Level Security (RLS)
* Supabase Edge Functions only when server-side logic is actually required

## QR

Use a standard QR-code generation library for ticket generation.

Use an HTML5-compatible/browser-based QR scanner for mobile scanning.

The scanner must work through a normal mobile browser and must not require a native mobile application.

## Apps Script

Apps Script must **not** be part of the new MVP request/response path.

The existing Apps Script implementation should be preserved only as legacy/reference code unless explicitly determined to be reusable for a non-core Google Workspace integration.

---

# 3. MVP Architecture

Target architecture:

React/Vite
|
+---- Supabase Auth
|
+---- Supabase PostgreSQL
|
+---- Supabase Storage (only if actually required)
|
+---- Supabase Edge Functions (only where necessary)

Do NOT introduce additional backend services unless there is a demonstrated technical requirement.

Do NOT introduce Firebase, a custom server, a VPS, or another database.

---

# 4. User Roles

The MVP has three operational roles.

## Public Applicant

Unauthenticated user.

Can:

* View published registration form
* Submit registration
* Receive/view QR ticket
* Retrieve their ticket

Cannot:

* View other applicants
* Modify arbitrary registrations
* Access admin functions
* Access staff functions

## Staff

Authenticated user.

Can:

* Access mobile scanner
* Scan applicant QR codes
* View the minimum information necessary to verify the applicant
* Perform check-in
* Search/lookup registrations if authorized

Cannot:

* Create/edit registration forms
* Delete registration data
* Modify administrative configuration

## Admin

Authenticated user.

Can:

* Create events
* Create/edit/publish registration forms
* Configure form fields
* View registrations
* Search registrations
* View check-in status
* Export data
* Access scanner
* Manage staff/admin access if the existing authentication architecture supports it

---

# 5. Core Data Model

Use PostgreSQL.

Minimum required tables:

## events

Fields:

* id
* name
* description
* event_date
* location
* status
* created_at
* updated_at

Possible status values:

* draft
* published
* closed
* archived

## forms

Fields:

* id
* event_id
* name
* description
* status
* version
* created_at
* updated_at
* published_at

A form belongs to an event.

## form_fields

Fields:

* id
* form_id
* field_key
* label
* field_type
* required
* options
* sort_order
* validation_rules
* created_at
* updated_at

The form builder must store field configuration in the database.

Do NOT hard-code registration questions into the applicant page.

## registrations

Minimum fields:

* id
* event_id
* form_id
* registration_number
* ticket_token
* first_name
* middle_name
* last_name
* suffix
* email
* mobile_number
* form_data
* status
* registered_at
* updated_at

`form_data` may use PostgreSQL JSONB for dynamic form responses.

Do not put personal information directly into the QR code.

## check_ins

Fields:

* id
* registration_id
* scanned_by
* scanned_at
* device_identifier
* status

A registration must not be successfully checked in more than once.

The database must enforce this condition.

---

# 6. Registration Flow

The public registration flow must be:

Applicant opens published form
↓
Completes required fields
↓
Frontend validates input
↓
Backend/database validates input
↓
Registration created
↓
Unique registration number generated
↓
Secure ticket token generated
↓
QR code generated
↓
Ticket displayed

Example registration number:

`JF26-000001`

The actual implementation may use another format, but it must be:

* unique
* non-guessable where appropriate
* associated with exactly one registration

Do not use sequential IDs as the QR authentication mechanism.

---

# 7. QR Ticket Requirements

The QR code must contain only a non-sensitive identifier/token.

Do NOT encode:

* full name
* email
* phone number
* address
* birth date
* other personal information

Example QR payload:

`ticket_token`

or an equivalent opaque identifier.

The ticket page should display:

* Event name
* Applicant name
* Registration number
* QR code
* Registration status
* Check-in status if appropriate

The ticket must be mobile-friendly.

It should also be possible to save/screenshot the ticket.

---

# 8. Ticket Retrieval

Applicants must be able to retrieve their ticket after leaving the registration page.

The MVP should avoid forcing applicants to create passwords unless authentication is technically required.

Preferred approach:

Registration Number
+
verification information

↓

Retrieve Ticket

The implementation must protect against trivial enumeration of other applicants.

Do not allow:

`JF26-000001`

to automatically reveal the applicant's personal information without verification.

The exact verification mechanism should be selected during implementation based on the existing project and security model.

---

# 9. Admin Form Builder

Admin must be able to create a registration form without changing source code.

Minimum supported field types:

1. Short text
2. Long text
3. Number
4. Date
5. Dropdown/select
6. Radio/single choice
7. Checkbox
8. Multi-select
9. Yes/No

Each field must support, where applicable:

* Label
* Required/optional
* Options
* Display order
* Basic validation

Admin must be able to:

* Add field
* Edit field
* Delete field
* Reorder field
* Configure options
* Publish form
* Unpublish/close form

Do NOT build a full Typeform-style visual form designer.

No conditional branching is required for MVP.

No drag-and-drop canvas is required unless it is already implemented and stable.

---

# 10. Mobile QR Scanner

Create a dedicated scanner page.

Example:

`/scanner`

Requirements:

* Works on modern Android/iOS mobile browsers
* Uses device camera
* Uses HTML5/browser APIs
* Does not require a native mobile application
* Clearly indicates camera permission requirements
* Provides visual scanning feedback
* Stops/restarts scanning safely
* Handles invalid QR codes
* Handles unknown tickets
* Handles already checked-in tickets
* Handles network failures

Scanner flow:

Scan QR
↓
Extract ticket token
↓
Validate token
↓
Find registration
↓
Atomically check registration status
↓
Record check-in
↓
Display result

Successful result:

VALID — CHECK-IN SUCCESSFUL

Display minimum verification information such as:

* Applicant name
* Registration number
* Time checked in

Already checked-in result:

ALREADY CHECKED IN

Display:

* Applicant name
* Registration number
* Original check-in time

Invalid result:

INVALID TICKET

Unknown result:

REGISTRATION NOT FOUND

Network/database failure:

CHECK-IN COULD NOT BE COMPLETED

Do not display a false successful check-in when the database transaction has not succeeded.

---

# 11. Duplicate Check-In Protection

This is a critical requirement.

Two scanners may scan the same QR almost simultaneously.

The backend/database must prevent:

Scanner A → success
Scanner B → success

for the same registration.

Only one check-in may succeed.

Use a database-level constraint and/or atomic transaction/RPC rather than relying solely on frontend logic.

The frontend must never be the authority for check-in status.

The database is authoritative.

---

# 12. Admin Registration Management

Admin must have a registration management page.

Minimum functionality:

* View registrations
* Search by name
* Search by registration number
* Search by email/mobile where appropriate
* Filter by event
* Filter by check-in status
* View registration details
* View registration date/time
* View check-in date/time

Do not build a complicated analytics system for MVP.

Basic counts are sufficient:

* Total registered
* Total checked in
* Total not checked in

---

# 13. Data Export

Admin must be able to export registration data.

Minimum format:

CSV

Include:

* Registration number
* Applicant information
* Form responses
* Registration date/time
* Check-in status
* Check-in date/time

Do not expose sensitive administrative fields in public interfaces.

---

# 14. Security Requirements

Supabase RLS must be enabled for all relevant tables.

Never solve permission problems by disabling RLS globally.

Public users must not be able to:

* Read all registrations
* Modify arbitrary registrations
* Delete registrations
* Access admin data

Staff must only access functions/data necessary for scanning and authorized lookup.

Admin has elevated privileges according to explicit policies.

Service-role credentials must NEVER be placed in frontend code.

Never expose:

`SUPABASE_SERVICE_ROLE_KEY`

to the browser.

Never put secrets in:

* React source
* Vite client environment variables
* QR payload
* public HTML

---

# 15. Registration Integrity

The database must enforce important constraints.

At minimum:

* Registration ID uniqueness
* Ticket token uniqueness
* Foreign-key relationships
* Required critical fields
* Valid event/form relationships
* Check-in uniqueness

Do not rely exclusively on JavaScript validation.

Frontend validation improves UX.

Database constraints protect data integrity.

---

# 16. Error Handling

User-facing errors must be understandable.

Do not expose raw database errors to applicants.

Examples:

Instead of:

`duplicate key value violates unique constraint...`

show:

`This registration already exists. Please retrieve your ticket instead.`

Instead of:

`new row violates row-level security policy...`

show an appropriate user-facing error while logging the technical error for debugging.

The application must distinguish:

* Validation error
* Duplicate registration
* Unauthorized operation
* Not found
* Rate limit
* Network failure
* Database failure
* Server failure

Do not collapse all failures into a generic error.

---

# 17. Rate Limiting

The system must have reasonable protection against abusive submissions.

However, legitimate repeated attempts must not unnecessarily lock out users during development or normal usage.

Do not implement a simplistic:

`same email → reject after N attempts`

mechanism without considering:

* duplicate registration
* failed validation
* network retry
* legitimate retry
* successful registration
* abuse

A successful existing registration should normally direct the user toward ticket retrieval rather than repeatedly returning a generic rate-limit error.

Rate limiting must not become a substitute for duplicate prevention.

---

# 18. Performance Requirements

The scanner is the highest-priority operational interface.

Optimize for:

* mobile devices
* unstable mobile connections
* low bandwidth
* fast QR recognition
* minimal page weight
* fast database lookup
* fast check-in response

Avoid unnecessary animations and large assets on the scanner page.

The scanner should remain usable on ordinary smartphones.

---

# 19. Offline Behavior

Full offline check-in synchronization is NOT required for MVP.

However, the scanner must clearly detect network/database failure.

Do NOT claim a check-in succeeded if the server/database has not confirmed it.

Offline queueing can be considered as a future enhancement after the online system is stable.

---

# 20. UI Requirements

The existing project's visual language may be retained where appropriate.

Prioritize:

* mobile-first registration
* simple navigation
* clear buttons
* readable forms
* accessible inputs
* fast scanner interface
* obvious success/error states

Do not spend excessive development time on decorative UI before the complete registration → ticket → scan → check-in flow works.

---

# 21. Explicitly OUT OF SCOPE

Do NOT implement these in the MVP:

* Employer management
* Job vacancy management
* Job matching
* AI matching
* Applications
* Interview management
* Employment outcomes
* Follow-up management
* Complex analytics
* AI agents
* Native Android application
* Native iOS application
* SMS integration
* Email marketing
* Payment processing
* Full offline scanner synchronization
* Complex workflow automation
* Advanced conditional form branching
* Full Typeform/Google Forms clone
* Complex reporting engine

These may be future phases.

---

# 22. Development Rules

The implementation must be incremental.

Do NOT rewrite the entire project in one operation.

Before modifying code:

1. Inspect the existing repository.
2. Identify reusable frontend components.
3. Identify existing Supabase configuration.
4. Identify existing migrations.
5. Identify existing authentication.
6. Identify existing registration/form/ticket/scanner functionality.
7. Identify existing Apps Script dependencies.

Preserve working code wherever practical.

Do not duplicate existing functionality.

Do not create parallel implementations of the same feature.

---

# 23. Required Implementation Phases

## Phase 0 — Audit

READ-ONLY.

Do not modify code.

Produce a report containing:

* Existing architecture
* Existing frontend routes
* Existing Supabase configuration
* Existing database schema
* Existing migrations
* Existing authentication
* Existing form functionality
* Existing QR functionality
* Existing scanner functionality
* Apps Script dependencies
* Reusable components
* Obsolete components
* Recommended migration plan

STOP after the audit.

Wait for approval before implementation.

---

## Phase 1 — Database

Implement only the required Supabase schema and migrations.

Verify:

* Tables
* Relationships
* Constraints
* RLS
* Required indexes

Test the schema before proceeding.

---

## Phase 2 — Admin Form Management

Implement:

* Admin authentication
* Event creation
* Form creation
* Form field management
* Publishing

Verify database persistence.

---

## Phase 3 — Applicant Registration

Implement:

* Public form
* Dynamic fields
* Validation
* Registration creation
* Duplicate handling
* Ticket token generation
* QR generation

Verify registration directly against the database.

---

## Phase 4 — Ticket

Implement:

* Ticket display
* Ticket retrieval
* QR display
* Mobile layout

Verify that ticket tokens cannot expose unrelated registrations.

---

## Phase 5 — Scanner

Implement:

* Mobile camera access
* QR decoding
* Registration lookup
* Atomic check-in
* Duplicate check-in protection
* Success/error states

This phase must receive especially rigorous testing.

---

## Phase 6 — Admin Data

Implement:

* Registration list
* Search
* Filters
* Check-in status
* Basic counts
* CSV export

---

# 24. Verification Requirements

Every phase must include verification.

Do not report:

`Implemented successfully`

without evidence.

For each phase report:

### Files changed

List every modified/created file.

### Database changes

List every migration/table/policy/index/function changed.

### Tests performed

List actual tests executed.

### Results

Use:

* PASS
* FAIL
* NOT TESTED

### Known issues

List unresolved issues explicitly.

### Manual testing instructions

Provide exact steps for the user to verify the feature.

---

# 25. Critical End-to-End Acceptance Test

The MVP is NOT considered complete until this works:

1. Admin logs in.
2. Admin creates an event.
3. Admin creates a registration form.
4. Admin adds multiple field types.
5. Admin publishes the form.
6. Applicant opens the public form on a phone.
7. Applicant submits registration.
8. Registration is saved in Supabase.
9. Applicant receives a unique registration number.
10. Applicant receives a QR ticket.
11. Applicant leaves the page.
12. Applicant retrieves the ticket.
13. Staff opens scanner on a smartphone.
14. Staff grants camera permission.
15. Staff scans the QR.
16. Backend finds the registration.
17. Database records the check-in.
18. Scanner displays successful check-in.
19. Staff scans the same QR again.
20. System displays `ALREADY CHECKED IN`.
21. Database contains only one successful check-in.
22. Admin sees the registration as checked in.
23. Admin can search for the applicant.
24. Admin can export the registration/check-in data.

If any of these fail, the MVP is not complete.

---

# 26. Definition of Done

The MVP is complete when:

* Registration works on mobile.
* Dynamic forms work.
* Registration data persists in Supabase.
* QR tickets are generated.
* Tickets can be retrieved.
* QR scanner works on mobile browsers.
* Check-in is database-authoritative.
* Duplicate check-in is prevented.
* Admin can manage forms.
* Admin can retrieve registration data.
* Admin can export data.
* RLS policies have been tested.
* No service-role secret is exposed to the frontend.
* Critical end-to-end test passes.
* No dependency on Apps Script remains in the core registration/check-in flow.
* OpenCode provides evidence for each implementation phase.

# Final Principle

Do not optimize for the most features.

Optimize for this flow being **boringly reliable**:

**Create Form → Register → Get QR → Retrieve QR → Scan → Check In → Retrieve Data.**

Everything else is secondary.
