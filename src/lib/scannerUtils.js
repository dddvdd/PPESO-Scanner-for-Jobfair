/**
 * Scanner-side pure helpers. No Supabase access here.
 */

/**
 * Ticket QR payload contract (Phase 2D): the raw 48-character lowercase hex
 * ticket_token, nothing else. Anything else — URLs, JSON, uppercase hex,
 * wrong lengths — is rejected locally without touching the backend.
 */
const TICKET_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export function isValidTicketToken(value) {
  return typeof value === "string" && TICKET_TOKEN_PATTERN.test(value);
}

/**
 * Map a performCheckIn() result to scanner view state.
 * result.ok  → { ok:true, outcome }
 * result.fail → { ok:false, outcome }   (network / permission / unexpected)
 *
 * Titles follow mvp_scope.md §10 wording; no raw backend errors surface.
 */
export function describeScanOutcome(result) {
  if (result.ok) {
    const d = result.data ?? {};
    switch (d.status) {
      case "success":
        return {
          tone: "success",
          title: "Check-in successful",
          applicantName: d.applicantName ?? null,
          registrationNumber: d.registrationNumber ?? null,
          checkedInAt: d.checkedInAt ?? null,
        };
      case "already_checked_in":
        return {
          tone: "duplicate",
          title: "Already checked in",
          applicantName: d.applicantName ?? null,
          registrationNumber: d.registrationNumber ?? null,
          checkedInAt: d.checkedInAt ?? null,
        };
      case "reason_required":
        return { tone: "invalid", title: "Enter a reason for this late check-in (up to 1,000 characters)." };
      case "not_past_event":
        return { tone: "invalid", title: "Late check-in is only available for past events." };
      case "invalid_ticket":
        return { tone: "invalid", title: "Invalid ticket" };
      case "event_date_mismatch":
        return {
          tone: "invalid",
          title: "Event date mismatch",
          applicantName: d.applicantName ?? null,
          registrationNumber: d.registrationNumber ?? null,
          detail: `This ticket is for ${d.eventName ? `"${d.eventName}"` : "an event"} scheduled on ${d.eventDate || "a different date"}, not today.`,
        };
      case "registration_not_found":
        // Generic invalid result — never reveal database internals.
        return { tone: "invalid", title: "Invalid ticket" };
      case "forbidden":
        return {
          tone: "forbidden",
          title: "You are not authorized to perform check-in.",
        };
      default:
        return {
          tone: "error",
          title: "Check-in could not be completed. Please try again.",
        };
    }
  }

  const failure = result.error ?? {};
  if (failure.kind === "network") {
    return {
      tone: "network",
      title: "Unable to contact the check-in service. Please try again.",
    };
  }
  if (failure.kind === "permission" || failure.token === "FORBIDDEN") {
    return {
      tone: "forbidden",
      title: "You are not authorized to perform check-in.",
    };
  }
  return {
    tone: "error",
    title: "Check-in could not be completed. Please try again.",
  };
}

const DEVICE_ID_STORAGE_KEY = "peso-scanner-device-id";

/**
 * Ephemeral operational identifier distinguishing this scanner instance in
 * check_ins.device_identifier. Random, non-sensitive by design: never
 * derived from applicant data, tokens, emails, or fingerprinting. Persisted
 * in localStorage purely so one physical device keeps a stable label across
 * shifts; falls back to a session-only value when storage is unavailable
 * (private mode).
 */
export function getDeviceId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `scanner-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return `ephemeral-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }
}
