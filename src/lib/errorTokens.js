/**
 * Centralized backend error contract.
 *
 * The database RPCs raise stable uppercase error tokens (mvp_scope.md §16).
 * This module is the ONLY place that maps those tokens to user-facing
 * meaning. UI code must branch on `failure.token` / `failure.kind` from
 * here — never on raw Postgres messages.
 *
 * Kinds:
 *   application — a controlled backend rejection (stable token available)
 *   permission  — RLS / execute-privilege denial (fail closed, generic copy)
 *   network     — request never reached the backend or response was lost;
 *                 MUST NOT be presented as an application-level result
 *   unknown     — anything else; generic copy
 */

export const ERROR_TOKENS = Object.freeze({
  FORM_NOT_FOUND: "FORM_NOT_FOUND",
  FORM_NOT_PUBLISHED: "FORM_NOT_PUBLISHED",
  EVENT_NOT_PUBLISHED: "EVENT_NOT_PUBLISHED",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_NUMBER: "INVALID_NUMBER",
  INVALID_DATE: "INVALID_DATE",
  INVALID_CHOICE: "INVALID_CHOICE",
  INVALID_EMAIL: "INVALID_EMAIL",
  INVALID_MOBILE: "INVALID_MOBILE",
  DUPLICATE_REGISTRATION: "DUPLICATE_REGISTRATION",
  REGISTRATION_FAILED: "REGISTRATION_FAILED",
  INVALID_ONLINE_POSITIONS: "INVALID_ONLINE_POSITIONS",
  ONLINE_EVENT_NOT_FOUND: "ONLINE_EVENT_NOT_FOUND",
  ONLINE_EVENT_SCHEMA_UNAVAILABLE: "ONLINE_EVENT_SCHEMA_UNAVAILABLE",
  INVALID_EVENT_DATE_RANGE: "INVALID_EVENT_DATE_RANGE",
  TICKET_NOT_FOUND: "TICKET_NOT_FOUND",
  REGISTRATION_NOT_FOUND: "REGISTRATION_NOT_FOUND",
  INVALID_TICKET: "INVALID_TICKET",
  FORBIDDEN: "FORBIDDEN",
});

const ERROR_KINDS = Object.freeze({
  APPLICATION: "application",
  PERMISSION: "permission",
  NETWORK: "network",
  UNKNOWN: "unknown",
});

const FIELD_TOKEN_PREFIXES = Object.freeze([
  ERROR_TOKENS.MISSING_REQUIRED_FIELD,
  ERROR_TOKENS.INVALID_NUMBER,
  ERROR_TOKENS.INVALID_DATE,
  ERROR_TOKENS.INVALID_CHOICE,
]);

const TOKEN_MESSAGES = Object.freeze({
  [ERROR_TOKENS.FORM_NOT_FOUND]:
    "This registration form is no longer available.",
  [ERROR_TOKENS.FORM_NOT_PUBLISHED]:
    "This form is not currently accepting registrations.",
  [ERROR_TOKENS.EVENT_NOT_PUBLISHED]:
    "This event is not currently accepting registrations.",
  [ERROR_TOKENS.MISSING_REQUIRED_FIELD]: "Please fill in all required fields.",
  [ERROR_TOKENS.INVALID_NUMBER]: "Please enter a valid number.",
  [ERROR_TOKENS.INVALID_DATE]: "Please enter a valid date in YYYY-MM-DD format.",
  [ERROR_TOKENS.INVALID_CHOICE]: "Please choose one of the available options.",
  [ERROR_TOKENS.INVALID_EMAIL]: "Please enter a valid email address.",
  [ERROR_TOKENS.INVALID_MOBILE]: "Please enter a valid mobile number.",
  [ERROR_TOKENS.DUPLICATE_REGISTRATION]:
    "This registration already exists. Use your saved QR ticket or ask event staff to find your registration at check-in.",
  [ERROR_TOKENS.REGISTRATION_FAILED]:
    "We could not complete your registration. Please try again.",
  [ERROR_TOKENS.INVALID_ONLINE_POSITIONS]:
    "Enter 1 to 500 positions, with one title of up to 500 characters per line.",
  [ERROR_TOKENS.ONLINE_EVENT_NOT_FOUND]: "This online event is no longer available.",
  [ERROR_TOKENS.ONLINE_EVENT_SCHEMA_UNAVAILABLE]:
    "Online event setup is missing from the connected database. Apply the pending Supabase migrations, then retry.",
  [ERROR_TOKENS.INVALID_EVENT_DATE_RANGE]: "Choose a start date and an end date on or after it.",
  [ERROR_TOKENS.TICKET_NOT_FOUND]:
    "We could not find a ticket matching that information.",
  [ERROR_TOKENS.REGISTRATION_NOT_FOUND]: "This registration could not be found.",
  [ERROR_TOKENS.INVALID_TICKET]: "This ticket is not valid for check-in.",
  [ERROR_TOKENS.FORBIDDEN]: "You are not authorized to perform this action.",
});

/**
 * Extract a stable token (and optional ":<key>" suffix) from a raw backend
 * message. Returns { token, field } or null when the message carries none.
 */
export function parseErrorToken(message) {
  const raw = typeof message === "string" ? message.trim() : "";
  if (!raw) return null;

  if (Object.prototype.hasOwnProperty.call(TOKEN_MESSAGES, raw)) {
    return { token: raw, field: null };
  }

  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    const base = raw.slice(0, colonIndex);
    if (FIELD_TOKEN_PREFIXES.includes(base)) {
      return { token: base, field: raw.slice(colonIndex + 1).trim() || null };
    }
  }

  return null;
}

function isNetworkFailure(raw) {
  if (raw instanceof TypeError) return true;
  const code = raw?.code;
  if (code) return false;
  const message = String(raw?.message ?? "");
  return /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(
    message
  );
}

function isPermissionFailure(raw) {
  if (raw?.code === "42501") return true;
  return /permission denied|row-level security/i.test(String(raw?.message ?? ""));
}

/**
 * Normalize any failure (thrown exception OR supabase-js `error` object)
 * into a single classified shape. Never throws.
 */
export function describeError(raw) {
  if (isNetworkFailure(raw)) {
    return {
      kind: ERROR_KINDS.NETWORK,
      token: null,
      field: null,
      message:
        "We could not reach the server. Check your connection and try again.",
      raw,
    };
  }

  if (isPermissionFailure(raw)) {
    return {
      kind: ERROR_KINDS.PERMISSION,
      token: ERROR_TOKENS.FORBIDDEN,
      field: null,
      message: TOKEN_MESSAGES[ERROR_TOKENS.FORBIDDEN],
      raw,
    };
  }

  const parsed = parseErrorToken(raw?.message) ??
    (raw?.code === "23514" && String(raw.message).includes("events_date_range_valid")
      ? { token: ERROR_TOKENS.INVALID_EVENT_DATE_RANGE, field: null }
      : null);
  if (parsed) {
    return {
      kind: ERROR_KINDS.APPLICATION,
      token: parsed.token,
      field: parsed.field,
      message: TOKEN_MESSAGES[parsed.token],
      raw,
    };
  }

  return {
    kind: ERROR_KINDS.UNKNOWN,
    token: null,
    field: null,
    message: "Something went wrong. Please try again.",
    raw,
  };
}

export { ERROR_KINDS };
