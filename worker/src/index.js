const GENERIC_ERROR = "Something went wrong. Please try again.";
const EMAIL_ERROR = "Check the email address and try again.";
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ALLOWED_ORIGINS = new Set([
  "https://tarmactime.com",
  "https://www.tarmactime.com",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(request, status, body) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const cors = corsHeaders(request);
  if (cors) Object.assign(headers, cors);
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  const local = email.split("@")[0];
  if (!local || local.length > 64) return false;
  if (email.includes("..")) return false;
  return EMAIL_PATTERN.test(email);
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80);
}

function honeypotTripped(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function publicationIdIsSafe(id) {
  return typeof id === "string" && /^pub_[0-9a-f-]{36}$/i.test(id);
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  if (request.method === "OPTIONS") {
    const cors = corsHeaders(request);
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }

  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(request, 403, { ok: false, error: GENERIC_ERROR });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { ok: false, error: GENERIC_ERROR });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, 400, { ok: false, error: EMAIL_ERROR });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(request, 400, { ok: false, error: EMAIL_ERROR });
  }

  if (honeypotTripped(payload.company)) {
    return jsonResponse(request, 200, { ok: true });
  }

  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return jsonResponse(request, 400, { ok: false, error: EMAIL_ERROR });
  }

  const publicationId = env && env.BEEHIIV_PUBLICATION_ID;
  const apiKey = env && env.BEEHIIV_API_KEY;
  if (!publicationIdIsSafe(publicationId) || typeof apiKey !== "string" || !apiKey.trim()) {
    console.error("subscribe is missing its server configuration");
    return jsonResponse(request, 500, { ok: false, error: GENERIC_ERROR });
  }

  const body = {
    email,
    reactivate_existing: false,
    send_welcome_email: true,
    utm_source: "tarmactime.com",
    referring_site: "https://tarmactime.com",
  };
  const firstName = cleanName(payload.first_name);
  if (firstName) {
    body.custom_fields = [{ name: "first_name", value: firstName }];
  }

  const url =
    "https://api.beehiiv.com/v2/publications/" +
    encodeURIComponent(publicationId) +
    "/subscriptions";

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey.trim(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    console.error("subscribe request failed");
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }

  try {
    if (response.text) await response.text();
  } catch {
    // The visitor never sees the upstream body.
  }

  if (!response.ok) {
    console.error("subscribe upstream status " + response.status);
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }

  return jsonResponse(request, 200, { ok: true });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env, fetch);
    } catch {
      console.error("subscribe handler failed");
      return jsonResponse(request, 500, { ok: false, error: GENERIC_ERROR });
    }
  },
};
