import { createClient } from "npm:@supabase/supabase-js@2";

const maxBodyBytes = 1_000_000;
const timestampToleranceSeconds = 300;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifySignature(payload: string, request: Request, secret: string) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  const timestampSeconds = Number(timestamp);
  if (
    !id ||
    !timestamp ||
    !signature ||
    !Number.isInteger(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > timestampToleranceSeconds ||
    !secret.startsWith("whsec_")
  ) {
    return false;
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${payload}`);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedContent));
  const expected = btoa(Array.from(digest, (byte) => String.fromCharCode(byte)).join(""));
  return signature.split(" ").some((versionedSignature) => {
    const [version, value] = versionedSignature.split(",", 2);
    return version === "v1" && !!value && constantTimeEqual(value, expected);
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Resend delivery webhook is not configured.");
    return jsonResponse({ error: "Webhook is not configured." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return jsonResponse({ error: "Request body is too large." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return jsonResponse({ error: "Webhook body is empty." }, 400);

  let payload: string;
  try {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        return jsonResponse({ error: "Request body is too large." }, 413);
      }
      chunks.push(value);
    }
    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payload = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    return jsonResponse({ error: "Could not read webhook body." }, 400);
  }

  try {
    if (!await verifySignature(payload, request, webhookSecret)) {
      return jsonResponse({ error: "Invalid webhook signature." }, 401);
    }
  } catch {
    console.error("Could not verify Resend webhook signature.");
    return jsonResponse({ error: "Could not verify webhook signature." }, 500);
  }

  let event: {
    type?: unknown;
    created_at?: unknown;
    data?: { email_id?: unknown };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ error: "Webhook body must be valid JSON." }, 400);
  }

  const statuses: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.delivery_delayed": "delayed",
    "email.failed": "failed",
    "email.suppressed": "failed",
  };
  if (typeof event.type !== "string" || !statuses[event.type]) {
    return jsonResponse({ status: "ignored" });
  }
  if (
    typeof event.data?.email_id !== "string" ||
    typeof event.created_at !== "string" ||
    !Number.isFinite(Date.parse(event.created_at))
  ) {
    return jsonResponse({ error: "Webhook event is missing valid email details." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("record_registration_correction_email_event", {
    p_event_id: request.headers.get("svix-id"),
    p_email_id: event.data.email_id,
    p_status: statuses[event.type],
    p_event_at: event.created_at,
  });
  if (error) {
    console.error("Could not record Resend correction email event.");
    return jsonResponse({ error: "Could not record email delivery status." }, 500);
  }
  if (data === "unknown") {
    return jsonResponse({ error: "Email send record is not available yet." }, 503);
  }
  return jsonResponse({ status: data });
});
