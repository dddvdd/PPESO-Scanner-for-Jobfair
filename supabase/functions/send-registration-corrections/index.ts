import { createClient } from "npm:@supabase/supabase-js@2";

const allowedFields = [
  "date_of_birth",
  "course",
  "pwd",
  "sex",
  "first_time_job_seeker",
  "returning_ofw",
  "returning_worker",
  "interested_in_skills_training",
  "province",
  "municipality_city",
  "barangay",
] as const;

const batchSize = 100;
const expiryDays = 7;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Candidate = {
  id: string;
  email: string;
  first_name: string;
  form_data: Record<string, unknown> | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isBlank(value: unknown) {
  return typeof value !== "string" || value.trim() === "";
}

function escapeHtml(value: string) {
  const escaped: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escaped[character] ?? character);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emailContent(firstName: string, eventName: string, link: string, expiry: string) {
  const greetingName = firstName.replace(/[\r\n]+/g, " ").trim() || "jobseeker";
  const safeName = escapeHtml(greetingName);
  const safeEvent = escapeHtml(eventName);
  const safeLink = escapeHtml(link);
  const text = `Hello ${greetingName},

We’re updating the registration records for ${eventName}. Some details are missing from your registration.

Please use your personal link to provide the missing information:
${link}

The form will ask only for the details missing from your registration. Please answer accurately. This link expires on ${expiry} and can be used once. Please don’t forward it.

We’ll use your answers to complete your job fair registration record and reporting. If you believe you received this message in error, contact the Public Employment Service Office through the official Provincial Government of Cagayan contact channels.

Thank you,
Public Employment Service Office`;
  const html = `<p>Hello ${safeName},</p>
<p>We’re updating the registration records for <strong>${safeEvent}</strong>. Some details are missing from your registration.</p>
<p>Please use your personal link to provide the missing information:</p>
<p><a href="${safeLink}">Complete your registration details</a></p>
<p>The form will ask only for the details missing from your registration. Please answer accurately. This link expires on ${escapeHtml(expiry)} and can be used once. Please don’t forward it.</p>
<p>We’ll use your answers to complete your job fair registration record and reporting. If you believe you received this message in error, contact the Public Employment Service Office through the official Provincial Government of Cagayan contact channels.</p>
<p>Thank you,<br>Public Employment Service Office</p>`;
  return { text, html };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Supabase Edge Function secrets are not configured.");
      return jsonResponse({ error: "Correction email service is not configured." }, 503);
    }

    const authorization = request.headers.get("Authorization");
    const accessToken = authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!accessToken) return jsonResponse({ error: "Sign in as an administrator." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !userData.user) return jsonResponse({ error: "Sign in as an administrator." }, 401);
    const { data: role, error: roleError } = await userClient.rpc("my_role");
    if (roleError || role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403);

    let body: { eventId?: unknown; action?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const action = body.action;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return jsonResponse({ error: "Select a valid event." }, 400);
    }
    if (action !== "preview" && action !== "send") {
      return jsonResponse({ error: "Choose preview or send." }, 400);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: event, error: eventError } = await serviceClient
      .from("events")
      .select("id, name")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) {
      console.error("Could not load the selected event.");
      return jsonResponse({ error: "Could not load the selected event." }, 500);
    }
    if (!event) return jsonResponse({ error: "The selected event was not found." }, 404);

    const registrations: Candidate[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await serviceClient
        .from("registrations")
        .select("id, email, first_name, form_data")
        .eq("event_id", eventId)
        .eq("entry_source", "pre_registration")
        .order("id", { ascending: true })
        .range(offset, offset + 499);
      if (error) {
        console.error("Could not load preregistrants for the correction campaign.");
        return jsonResponse({ error: "Could not load preregistrants for this event." }, 500);
      }
      registrations.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }

    const candidates = registrations.flatMap((registration) => {
      const missingFields = allowedFields.filter((field) => isBlank(registration.form_data?.[field]));
      if (missingFields.length === 0) return [];
      return [{ ...registration, missingFields }];
    });

    if (action === "preview") {
      return jsonResponse({
        status: "ok",
        eventName: event.name,
        eligible: candidates.length,
        expiryDays,
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    const appBaseUrl = Deno.env.get("APP_BASE_URL");
    if (!resendApiKey || !fromEmail || !appBaseUrl) {
      return jsonResponse({
        error: "Sending is not configured. Set RESEND_API_KEY, RESEND_FROM_EMAIL, and APP_BASE_URL in Supabase Edge Function secrets.",
      }, 503);
    }
    const appUrl = new URL(appBaseUrl);
    if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
      return jsonResponse({ error: "APP_BASE_URL must use HTTPS." }, 503);
    }
    const correctionUrl = `${appUrl.origin.replace(/\/$/, "")}/registration-correction`;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const sendable = candidates.filter((candidate) => {
      if (candidate.email.length <= 254 && validEmail.test(candidate.email)) return true;
      skipped += 1;
      return false;
    });

    for (let offset = 0; offset < sendable.length; offset += batchSize) {
      const batch = sendable.slice(offset, offset + batchSize);
      const tokenRecords = await Promise.all(batch.map(async (candidate) => {
        const token = randomToken();
        const tokenHash = await hashToken(token);
        const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
        return {
          registration_id: candidate.id,
          token_hash: tokenHash,
          missing_fields: candidate.missingFields,
          expires_at: expiresAt,
          sent_at: new Date().toISOString(),
          token,
          expiresAt,
        };
      }));

      const registrationIds = batch.map((candidate) => candidate.id);
      const { error: revokeError } = await serviceClient
        .from("registration_correction_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .in("registration_id", registrationIds)
        .is("used_at", null)
        .is("revoked_at", null);
      if (revokeError) {
        console.error("Could not revoke previous active correction links.");
        failed += batch.length;
        continue;
      }

      const { error: insertError } = await serviceClient
        .from("registration_correction_tokens")
        .insert(tokenRecords.map(({ token: _token, expiresAt: _expiresAt, ...record }) => record));
      if (insertError) {
        console.error("Could not create correction-link records.");
        failed += batch.length;
        continue;
      }

      const messages = batch.map((candidate, index) => {
        const record = tokenRecords[index];
        const link = `${correctionUrl}#token=${record.token}`;
        const expiry = new Date(record.expiresAt).toLocaleString("en-PH", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Asia/Manila",
        }) + " (Philippine time)";
        const content = emailContent(candidate.first_name, event.name, link, expiry);
        return {
          from: fromEmail,
          to: [candidate.email],
          subject: "Please complete your job fair registration details",
          html: content.html,
          text: content.text,
        };
      });

      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messages),
        });
      } catch {
        console.error("Email provider request failed before returning a response.");
        const { error: cleanupError } = await serviceClient
          .from("registration_correction_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .in("token_hash", tokenRecords.map((record) => record.token_hash))
          .is("used_at", null);
        if (cleanupError) console.error("Could not revoke correction links for failed email batch.");
        failed += batch.length;
        continue;
      }

      if (!response.ok) {
        console.error(`Email provider rejected a correction batch (HTTP ${response.status}).`);
        const { error: cleanupError } = await serviceClient
          .from("registration_correction_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .in("token_hash", tokenRecords.map((record) => record.token_hash))
          .is("used_at", null);
        if (cleanupError) console.error("Could not revoke correction links for rejected email batch.");
        failed += batch.length;
        continue;
      }

      const providerResult = await response.json();
      if (!Array.isArray(providerResult.data) || providerResult.data.length !== batch.length) {
        console.error("Email provider returned an unexpected batch response; delivery may be partial.");
        failed += batch.length;
        continue;
      }
      sent += batch.length;
    }

    return jsonResponse({ status: "ok", eventName: event.name, eligible: candidates.length, sent, failed, skipped, expiryDays });
  } catch (error) {
    console.error("Unexpected correction email handler failure.", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "The correction email request could not be completed." }, 500);
  }
});
