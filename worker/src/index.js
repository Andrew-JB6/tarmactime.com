const GENERIC_ERROR = "Something went wrong. Please try again.";
const EMAIL_ERROR = "Check the email address and try again.";
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ALLOWED_ORIGINS = new Set([
  "https://tarmactime.com",
  "https://www.tarmactime.com",
]);

const FALLBACK_LATEST_URL = "https://tarmactime.beehiiv.com/";
const LATEST_CACHE_SECONDS = 300;
const LATEST_CACHE_REQUEST = new Request(
  "https://tarmactime-signup.tarmactime.workers.dev/__latest_url"
);

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

function isLatestPath(pathname) {
  return pathname === "/latest" || pathname === "/latest/";
}

function redirectTo(url, cacheSeconds) {
  const headers = { Location: url };
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = "public, max-age=" + cacheSeconds;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(null, { status: 302, headers });
}

function isSafePostUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "tarmactime.beehiiv.com" &&
      url.pathname.startsWith("/p/") &&
      url.pathname.length > 3 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function publishTimeMs(post) {
  const value =
    post &&
    (post.publish_date ?? post.scheduled_at ?? post.published_at ?? null);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function postWebUrl(post) {
  if (!post || typeof post !== "object") return "";
  if (typeof post.web_url === "string") return post.web_url;
  if (typeof post.url === "string") return post.url;
  return "";
}

export function pickLatestWebUrl(payload, nowMs = Date.now()) {
  const posts = Array.isArray(payload && payload.data) ? payload.data : [];
  for (const post of posts) {
    if (!post || typeof post !== "object") continue;
    const platform = post.platform;
    if (platform && platform !== "web" && platform !== "both") continue;
    const publishedAt = publishTimeMs(post);
    if (publishedAt == null || publishedAt > nowMs) continue;
    const url = postWebUrl(post);
    if (!isSafePostUrl(url)) continue;
    return url;
  }
  return null;
}

function postsListUrl(publicationId) {
  return (
    "https://api.beehiiv.com/v2/publications/" +
    encodeURIComponent(publicationId) +
    "/posts?status=confirmed&order_by=publish_date&direction=desc&limit=25"
  );
}

function getCacheStore(cacheImpl) {
  if (cacheImpl) return cacheImpl;
  try {
    return globalThis.caches && globalThis.caches.default
      ? globalThis.caches.default
      : null;
  } catch {
    return null;
  }
}

async function readCachedLatestUrl(cache) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const cached = await cache.match(LATEST_CACHE_REQUEST);
    if (!cached) return null;
    const payload = await cached.json();
    if (!payload || typeof payload.url !== "string") return null;
    if (!isSafePostUrl(payload.url)) return null;
    return payload.url;
  } catch {
    return null;
  }
}

async function writeCachedLatestUrl(cache, url) {
  if (!cache || typeof cache.put !== "function") return;
  try {
    await cache.put(
      LATEST_CACHE_REQUEST,
      new Response(JSON.stringify({ url }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + LATEST_CACHE_SECONDS,
        },
      })
    );
  } catch {
    // Cache is a performance help, not a requirement.
  }
}

async function resolveLatestUrl(env, fetchImpl) {
  const publicationId = env && env.BEEHIIV_PUBLICATION_ID;
  const apiKey = env && env.BEEHIIV_API_KEY;
  if (!publicationIdIsSafe(publicationId) || typeof apiKey !== "string" || !apiKey.trim()) {
    console.error("latest is missing its server configuration");
    return { url: FALLBACK_LATEST_URL, cacheSeconds: 0 };
  }

  let response;
  try {
    response = await fetchImpl(postsListUrl(publicationId), {
      method: "GET",
      headers: {
        Authorization: "Bearer " + apiKey.trim(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    console.error("latest posts request failed");
    return { url: FALLBACK_LATEST_URL, cacheSeconds: 0 };
  }

  if (!response || !response.ok) {
    console.error("latest upstream status " + (response && response.status));
    try {
      if (response && response.text) await response.text();
    } catch {
      // The visitor never sees the upstream body.
    }
    return { url: FALLBACK_LATEST_URL, cacheSeconds: 0 };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error("latest posts response was not JSON");
    return { url: FALLBACK_LATEST_URL, cacheSeconds: 0 };
  }

  const url = pickLatestWebUrl(payload);
  if (!url) {
    console.error("latest found no published web post");
    return { url: FALLBACK_LATEST_URL, cacheSeconds: 0 };
  }
  return { url, cacheSeconds: LATEST_CACHE_SECONDS };
}

export async function handleLatest(request, env, fetchImpl = fetch, cacheImpl) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }

  const cache = getCacheStore(cacheImpl);
  const cachedUrl = await readCachedLatestUrl(cache);
  if (cachedUrl) {
    return redirectTo(cachedUrl, LATEST_CACHE_SECONDS);
  }

  const resolved = await resolveLatestUrl(env, fetchImpl);
  if (resolved.cacheSeconds > 0) {
    await writeCachedLatestUrl(cache, resolved.url);
  }
  return redirectTo(resolved.url, resolved.cacheSeconds);
}

export async function handleRequest(request, env, fetchImpl = fetch, cacheImpl) {
  const url = new URL(request.url);
  if (isLatestPath(url.pathname)) {
    return handleLatest(request, env, fetchImpl, cacheImpl);
  }

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

  const subscribeUrl =
    "https://api.beehiiv.com/v2/publications/" +
    encodeURIComponent(publicationId) +
    "/subscriptions";

  let response;
  try {
    response = await fetchImpl(subscribeUrl, {
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
      console.error("worker handler failed");
      try {
        const url = new URL(request.url);
        if (url.pathname === "/latest" || url.pathname === "/latest/") {
          return new Response(null, {
            status: 302,
            headers: {
              Location: FALLBACK_LATEST_URL,
              "Cache-Control": "no-store",
            },
          });
        }
      } catch {
        // Fall through to the generic signup error.
      }
      return jsonResponse(request, 500, { ok: false, error: GENERIC_ERROR });
    }
  },
};
