import { getSupabase } from "./supabaseClient.js";
import { describeError } from "./errorTokens.js";

/**
 * Single sanctioned data-access layer between UI and the verified Supabase
 * backend (DEV: chsbyqtjymbagbyqvgdw). Every call returns:
 *
 *   success → { ok: true, data }
 *   failure → { ok: false, error }   where error = describeError(...)
 *
 * Authorization is enforced by the database (RLS + RPC guards); this layer
 * performs no authorization logic of its own and never writes to
 * registrations/check_ins except through their dedicated RPCs.
 */

function ok(data) {
  return { ok: true, data };
}

function fail(raw) {
  return { ok: false, error: describeError(raw) };
}

async function toResult(queryFactory) {
  try {
    const { data, error } = await queryFactory();
    return error ? fail(error) : ok(data);
  } catch (thrown) {
    return fail(thrown);
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmptyTextOrNull(value) {
  const trimmed = text(value);
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Public / anonymous
// ---------------------------------------------------------------------------

/**
 * Events visible to the public. RLS (`events_read_public`) independently
 * hides drafts; the status filter mirrors that contract for clarity.
 */
export function listPublishedEvents() {
  return toResult(() =>
    getSupabase()
      .from("events")
      .select("id, name, description, event_date, location, status")
      .in("status", ["published", "closed", "archived"])
      .order("event_date", { ascending: true, nullsFirst: false })
  );
}

/**
 * Latest published form for an event plus its fields in display order.
 * Returns { form, fields } or null when the event has no published form.
 * `FORM_NOT_FOUND` / `FORM_NOT_PUBLISHED` remain registration-time RPC
 * decisions; this read only powers rendering.
 */
export async function getPublishedFormWithFields(eventId) {
  const supabase = getSupabase();

  const formsResult = await toResult(() =>
    supabase
      .from("forms")
      .select(
        "id, event_id, name, description, status, version, published_at"
      )
      .eq("event_id", eventId)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
  );
  if (!formsResult.ok) return formsResult;

  const form = formsResult.data?.[0];
  if (!form) return ok(null);

  const fieldsResult = await toResult(() =>
    supabase
      .from("form_fields")
      .select(
        "id, form_id, field_key, label, field_type, required, options, sort_order"
      )
      .eq("form_id", form.id)
      .order("sort_order", { ascending: true })
  );
  if (!fieldsResult.ok) return fieldsResult;

  return ok({ form, fields: fieldsResult.data ?? [] });
}

/**
 * Submit an applicant registration. The ONLY permitted write path to
 * `registrations` — direct table INSERT is blocked by RLS and forbidden by
 * architecture.
 *
 * Contract notes:
 * - optional middleName/suffix are normalized to "" (never undefined)
 * - formData keys must match configured field_key values
 * - scalar answers are strings; checkbox/multi_select answers are arrays of
 *   exact option strings
 */
export async function registerApplicant(input) {
  const params = {
    p_event_id: input?.eventId,
    p_form_id: input?.formId,
    p_first_name: text(input?.firstName),
    p_last_name: text(input?.lastName),
    p_email: text(input?.email),
    p_mobile_number: text(input?.mobileNumber),
    p_middle_name: text(input?.middleName),
    p_suffix: text(input?.suffix),
    p_form_data:
      input?.formData && typeof input.formData === "object"
        ? input.formData
        : {},
  };

  const result = await toResult(() =>
    getSupabase().rpc("register_applicant", params)
  );
  if (!result.ok) return result;

  const d = result.data ?? {};
  return ok({
    registrationId: d.registration_id ?? null,
    registrationNumber: d.registration_number ?? null,
    ticketToken: d.ticket_token ?? null,
  });
}

/**
 * Retrieve a ticket with registration number + verification email.
 * The backend deliberately returns the same TICKET_NOT_FOUND signal whether
 * the number is unknown or the email does not match; this wrapper preserves
 * that indistinguishability and maps both to the single generic token.
 */
export async function retrieveTicket(registrationNumber, verificationEmail) {
  const result = await toResult(() =>
    getSupabase().rpc("retrieve_ticket", {
      p_registration_number: text(registrationNumber),
      p_verification_email: text(verificationEmail),
    })
  );
  if (!result.ok) return result;

  const d = result.data ?? {};
  return ok({
    registrationNumber: d.registration_number ?? null,
    ticketToken: d.ticket_token ?? null,
    firstName: d.first_name ?? null,
    middleName: d.middle_name ?? null,
    lastName: d.last_name ?? null,
    suffix: d.suffix ?? null,
    email: d.email ?? null,
    eventName: d.event_name ?? null,
    eventDate: d.event_date ?? null,
    location: d.location ?? null,
    registrationStatus: d.registration_status ?? null,
    registeredAt: d.registered_at ?? null,
    checkedInAt: d.checked_in_at ?? null,
  });
}

// ---------------------------------------------------------------------------
// Staff (database-authorized via perform_check_in / staff_lookup guards)
// ---------------------------------------------------------------------------

/**
 * Atomic check-in against a scanned ticket token. The result object is the
 * database verdict passed through untouched ({status: success |
 * already_checked_in | registration_not_found | invalid_ticket | forbidden |
 * error}); race safety lives entirely in the database. No optimistic
 * success may ever be derived client-side.
 */
export async function performCheckIn(ticketToken, deviceIdentifier) {
  const result = await toResult(() =>
    getSupabase().rpc("perform_check_in", {
      p_ticket_token: text(ticketToken),
      p_device_identifier: nonEmptyTextOrNull(deviceIdentifier),
    })
  );
  if (!result.ok) return result;

  const d = result.data ?? {};
  return ok({
    status: d.status ?? "error",
    registrationNumber: d.registration_number ?? null,
    applicantName: d.applicant_name ?? null,
    eventName: d.event_name ?? null,
    eventDate: d.event_date ?? null,
    checkedInAt: d.checked_in_at ?? null,
    message: d.message ?? null,
  });
}

/** Authorized registration lookup for scanner/admin use. Staff-only in DB. */
export async function staffLookup(query) {
  const result = await toResult(() =>
    getSupabase().rpc("staff_lookup", { p_query: text(query) })
  );
  if (!result.ok) return result;

  const d = result.data ?? {};
  const results = Array.isArray(d.results)
    ? d.results.map((row) => ({
        registrationNumber: row.registration_number ?? null,
        ticketToken: row.ticket_token ?? null,
        applicantName: row.applicant_name ?? null,
        email: row.email ?? null,
        eventName: row.event_name ?? null,
        eventDate: row.event_date ?? null,
        registrationStatus: row.registration_status ?? null,
        checkedInAt: row.checked_in_at ?? null,
      }))
    : [];

  return ok({ status: d.status ?? "ok", results });
}

// ---------------------------------------------------------------------------
// Auth / role
// ---------------------------------------------------------------------------

/**
 * Supabase Auth password sign-in for staff/admin accounts (applicants never
 * authenticate). Uses the existing anon client; passwords are never stored
 * anywhere by this application. Application role is resolved separately via
 * myRole() — a successful sign-in says nothing about staff standing.
 */
export async function signInWithPassword(email, password) {
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email: typeof email === "string" ? email.trim() : "",
      password: typeof password === "string" ? password : "",
    });
    if (error) {
      const message = String(error.message ?? "");
      if (/invalid login credentials/i.test(message)) {
        return {
          ok: false,
          error: {
            kind: "application",
            token: null,
            field: null,
            message: "Invalid email or password.",
            raw: error,
          },
        };
      }
      if (/email not confirmed/i.test(message)) {
        return {
          ok: false,
          error: {
            kind: "application",
            token: null,
            field: null,
            message: "This account's email address has not been confirmed yet.",
            raw: error,
          },
        };
      }
      return fail(error);
    }
    return ok({ userId: data.user?.id ?? null });
  } catch (thrown) {
    return fail(thrown);
  }
}

/**
 * Update the signed-in user's own password. Requires an active session;
 * Supabase rejects the call when the session has expired.
 */
export async function updatePassword(newPassword) {
  try {
    const { error } = await getSupabase().auth.updateUser({
      password: typeof newPassword === "string" ? newPassword : "",
    });
    return error ? fail(error) : ok(true);
  } catch (thrown) {
    return fail(thrown);
  }
}

/**
 * Application role for the current session: 'admin' | 'staff' | null.
 * NEVER derive the application role from session.user.role — every signed-in
 * Supabase user carries the JWT role "authenticated", which says nothing
 * about admin/staff standing.
 */
export async function myRole() {
  const result = await toResult(() => getSupabase().rpc("my_role"));
  if (!result.ok) return result;
  const value = result.data;
  return ok(value === "admin" || value === "staff" ? value : null);
}

// ---------------------------------------------------------------------------
// Admin helpers (RLS-authoritative; *_manage_admin / registrations_admin_all)
// Thin table wrappers for later admin phases — no admin UI here.
// ---------------------------------------------------------------------------

export function adminListEvents() {
  return toResult(() =>
    getSupabase()
      .from("events")
      .select("*")
      .order("created_at", { ascending: false })
  );
}

export function adminCreateEvent(fields) {
  return toResult(() => getSupabase().from("events").insert(fields).select().single());
}

export function adminUpdateEvent(eventId, patch) {
  return toResult(() =>
    getSupabase().from("events").update(patch).eq("id", eventId).select().single()
  );
}

export function adminCreateForm({ eventId, name, description }) {
  return toResult(() =>
    getSupabase()
      .from("forms")
      .insert({ event_id: eventId, name, description, status: "published", published_at: new Date().toISOString() })
      .select()
      .single()
  );
}

export function adminUpdateForm(formId, patch) {
  return toResult(() =>
    getSupabase().from("forms").update(patch).eq("id", formId).select().single()
  );
}

export function adminDeleteForm(formId) {
  return toResult(() =>
    getSupabase().from("forms").delete().eq("id", formId)
  );
}

export function adminCreateField(fields) {
  return toResult(() =>
    getSupabase().from("form_fields").insert(fields).select().single()
  );
}

export function adminUpdateField(fieldId, patch) {
  return toResult(() =>
    getSupabase()
      .from("form_fields")
      .update(patch)
      .eq("id", fieldId)
      .select()
      .single()
  );
}

export function adminDeleteField(fieldId) {
  return toResult(() =>
    getSupabase().from("form_fields").delete().eq("id", fieldId)
  );
}

/**
 * Registration records for management views. Anonymous/staff sessions see
 * zero rows here by RLS design — public flows must use registerApplicant /
 * retrieveTicket instead. Returns raw database rows (snake_case columns);
 * mapping to view models belongs to the admin UI phase.
 */
export function adminListRegistrations({ eventId, limit = 200 } = {}) {
  let query = getSupabase()
    .from("registrations")
    .select(
      "id, event_id, form_id, registration_number, first_name, middle_name, last_name, suffix, email, mobile_number, form_data, status, registered_at"
    )
    .order("registered_at", { ascending: false })
    .limit(limit);
  if (eventId) query = query.eq("event_id", eventId);
  return toResult(() => query);
}

export function adminListProfiles() {
  return toResult(() =>
    getSupabase()
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: true })
  );
}

export function adminUpdateProfileRole(profileId, role) {
  return toResult(() =>
    getSupabase()
      .from("profiles")
      .update({ role })
      .eq("id", profileId)
      .select()
      .single()
  );
}

export function adminDeleteEvent(eventId) {
  return toResult(() =>
    getSupabase().from("events").delete().eq("id", eventId)
  );
}

export function adminDeleteProfile(profileId) {
  return toResult(() =>
    getSupabase().from("profiles").delete().eq("id", profileId)
  );
}

export function adminCreateUser({ email, password, role = "staff" }) {
  return toResult(() =>
    getSupabase().rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_role: role,
    })
  );
}

// --- Undo support: snapshot before delete, re-insert verbatim after ---------

export function adminListEventForms(eventId) {
  return toResult(() =>
    getSupabase()
      .from("forms")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
  );
}

export function adminListFormFields(formIds) {
  return toResult(() =>
    getSupabase().from("form_fields").select("*").in("form_id", formIds)
  );
}

export function adminRestoreEvent(row) {
  return toResult(() =>
    getSupabase().from("events").insert(row).select().single()
  );
}

export function adminRestoreForms(rows) {
  return toResult(() => getSupabase().from("forms").insert(rows));
}

export function adminRestoreFormFields(rows) {
  return toResult(() => getSupabase().from("form_fields").insert(rows));
}

export function adminRestoreProfile(row) {
  return toResult(() =>
    getSupabase().from("profiles").insert(row).select().single()
  );
}
