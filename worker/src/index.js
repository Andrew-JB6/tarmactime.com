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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
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

  if (url.pathname === "/posts" || url.pathname === "/posts/") {
    return handlePostsList(request, env, fetchImpl, cacheImpl);
  }

  const postMatch = url.pathname.match(/^\/post\/([^/]+)\/?$/);
  if (postMatch) {
    return handlePostContent(request, env, postMatch[1], fetchImpl, cacheImpl);
  }

  if (url.pathname === "/access" || url.pathname === "/access/") {
    return handleAccess(request, env, fetchImpl);
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    return jsonResponse(request, 404, { ok: false, error: "Not found." });
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

  const token = await issueReadToken(env);
  return jsonResponse(request, 200, token ? { ok: true, token } : { ok: true });
}

// ---------------------------------------------------------------------------
// Issues list, reader gate, and gated post content
// ---------------------------------------------------------------------------

const POSTS_CACHE_SECONDS = 300;
const POSTS_CACHE_REQUEST = new Request(
  "https://tarmactime-signup.tarmactime.workers.dev/__posts_list_v1"
);
const POST_CACHE_PREFIX = "https://tarmactime-signup.tarmactime.workers.dev/__post_v1/";
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const ACCESS_NOT_FOUND =
  "We couldn't find an active subscription for that email. Join below to read.";

function publicJson(request, status, body, cacheSeconds) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control":
      cacheSeconds > 0 ? "public, max-age=" + cacheSeconds : "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const cors = corsHeaders(request);
  if (cors) Object.assign(headers, cors);
  else headers.Vary = "Origin";
  return new Response(JSON.stringify(body), { status, headers });
}

function serverConfig(env) {
  const publicationId = env && env.BEEHIIV_PUBLICATION_ID;
  const apiKey = env && env.BEEHIIV_API_KEY;
  if (!publicationIdIsSafe(publicationId) || typeof apiKey !== "string" || !apiKey.trim()) {
    return null;
  }
  return { publicationId, apiKey: apiKey.trim() };
}

function isPublishedWebPost(post, nowMs) {
  if (!post || typeof post !== "object") return false;
  if (post.status && post.status !== "confirmed") return false;
  const platform = post.platform;
  if (platform !== "web" && platform !== "both") return false;
  if (post.hidden_from_feed === true) return false;
  if (post.audience && post.audience !== "free" && post.audience !== "both") return false;
  const publishedAt = publishTimeMs(post);
  if (publishedAt == null || publishedAt > nowMs) return false;
  return isSafePostUrl(postWebUrl(post));
}

function safeImageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function postSummary(post) {
  return {
    id: post.id,
    title: cleanText(post.title, 300),
    subtitle: cleanText(post.subtitle, 400),
    publish_date: new Date(publishTimeMs(post)).toISOString(),
    thumbnail_url: safeImageUrl(post.thumbnail_url),
    slug: cleanText(post.slug, 200),
    web_url: postWebUrl(post),
  };
}

export function pickPublishedWebPosts(payload, nowMs = Date.now()) {
  const posts = Array.isArray(payload && payload.data) ? payload.data : [];
  return posts
    .filter((post) => isPublishedWebPost(post, nowMs) && postIdIsSafe(post.id))
    .sort((a, b) => publishTimeMs(b) - publishTimeMs(a))
    .map(postSummary);
}

function postIdIsSafe(id) {
  return typeof id === "string" && /^post_[0-9a-f-]{36}$/i.test(id);
}

async function cacheGetJson(cache, key) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const cached = await cache.match(key);
    if (!cached) return null;
    return await cached.json();
  } catch {
    return null;
  }
}

async function cachePutJson(cache, key, value, seconds) {
  if (!cache || typeof cache.put !== "function") return;
  try {
    await cache.put(
      key,
      new Response(JSON.stringify(value), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + seconds,
        },
      })
    );
  } catch {
    // Cache is optional.
  }
}

async function beehiivGet(config, path, fetchImpl) {
  const response = await fetchImpl("https://api.beehiiv.com/v2" + path, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + config.apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });
  return response;
}

async function loadPublishedPosts(env, fetchImpl, cache) {
  const cached = await cacheGetJson(cache, POSTS_CACHE_REQUEST);
  if (cached && Array.isArray(cached.posts)) {
    return cached.posts.filter((p) => Date.parse(p.publish_date) <= Date.now());
  }
  const config = serverConfig(env);
  if (!config) {
    console.error("posts is missing its server configuration");
    return null;
  }
  let response;
  try {
    response = await beehiivGet(
      config,
      "/publications/" +
        encodeURIComponent(config.publicationId) +
        "/posts?status=confirmed&platform=all&order_by=publish_date&direction=desc&limit=100",
      fetchImpl
    );
  } catch {
    console.error("posts request failed");
    return null;
  }
  if (!response || !response.ok) {
    console.error("posts upstream status " + (response && response.status));
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const posts = pickPublishedWebPosts(payload);
  await cachePutJson(cache, POSTS_CACHE_REQUEST, { posts }, POSTS_CACHE_SECONDS);
  return posts;
}

export async function handlePostsList(request, env, fetchImpl = fetch, cacheImpl) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return publicJson(request, 405, { ok: false, error: GENERIC_ERROR }, 0);
  }
  const posts = await loadPublishedPosts(env, fetchImpl, getCacheStore(cacheImpl));
  if (!posts) return publicJson(request, 502, { ok: false, error: GENERIC_ERROR }, 0);
  return publicJson(request, 200, { ok: true, posts }, POSTS_CACHE_SECONDS);
}

// --- Read tokens -----------------------------------------------------------

function base64UrlEncode(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function gateSecret(env) {
  const secret = env && env.GATE_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

export async function issueReadToken(env, nowMs = Date.now()) {
  const secret = gateSecret(env);
  if (!secret) return null;
  const body = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({ v: 1, exp: Math.floor(nowMs / 1000) + TOKEN_LIFETIME_SECONDS })
    )
  );
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return body + "." + base64UrlEncode(signature);
}

export async function verifyReadToken(env, token, nowMs = Date.now()) {
  const secret = gateSecret(env);
  if (!secret || typeof token !== "string" || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    return (
      claims &&
      claims.v === 1 &&
      typeof claims.exp === "number" &&
      claims.exp * 1000 > nowMs
    );
  } catch {
    return false;
  }
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

// --- Existing subscriber access ---------------------------------------------

export async function handleAccess(request, env, fetchImpl = fetch) {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
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
  const email = normalizeEmail(payload && payload.email);
  if (!isValidEmail(email)) {
    return jsonResponse(request, 400, { ok: false, error: EMAIL_ERROR });
  }
  const config = serverConfig(env);
  if (!config || !gateSecret(env)) {
    console.error("access is missing its server configuration");
    return jsonResponse(request, 500, { ok: false, error: GENERIC_ERROR });
  }

  let response;
  try {
    response = await beehiivGet(
      config,
      "/publications/" +
        encodeURIComponent(config.publicationId) +
        "/subscriptions/by_email/" +
        encodeURIComponent(email),
      fetchImpl
    );
  } catch {
    console.error("access lookup failed");
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }

  if (response.status === 404) {
    try { await response.text(); } catch {}
    return jsonResponse(request, 404, { ok: false, error: ACCESS_NOT_FOUND });
  }
  if (!response.ok) {
    console.error("access upstream status " + response.status);
    try { await response.text(); } catch {}
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }

  let data;
  try {
    data = (await response.json()).data;
  } catch {
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }
  if (!data || data.status !== "active") {
    return jsonResponse(request, 404, { ok: false, error: ACCESS_NOT_FOUND });
  }
  const token = await issueReadToken(env);
  return jsonResponse(request, 200, { ok: true, token });
}

// --- Gated post content -------------------------------------------------------

const REMOVE_ELEMENTS =
  "script, noscript, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, option, base, meta, template, portal";
const URL_ATTRIBUTES = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "background", "srcset", "data"]);

export async function sanitizePostHtml(html) {
  const rewriter = new HTMLRewriter()
    .on(REMOVE_ELEMENTS, {
      element(element) {
        element.remove();
      },
    })
    .on("link", {
      element(element) {
        const rel = (element.getAttribute("rel") || "").toLowerCase();
        const href = element.getAttribute("href") || "";
        const fontSheet = rel === "stylesheet" && href.startsWith("https://fonts.googleapis.com/");
        const fontPreconnect = rel === "preconnect" && href.startsWith("https://fonts.gstatic.com");
        if (!fontSheet && !fontPreconnect) element.remove();
      },
    })
    .on("*", {
      element(element) {
        const names = [];
        for (const [name] of element.attributes) names.push(name);
        for (const name of names) {
          const lower = name.toLowerCase();
          const value = element.getAttribute(name) || "";
          if (lower.startsWith("on")) {
            element.removeAttribute(name);
          } else if (
            URL_ATTRIBUTES.has(lower) &&
            /^\s*(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp);))/i.test(value)
          ) {
            element.removeAttribute(name);
          }
        }
      },
    })
    .on("a", {
      element(element) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer nofollow");
      },
    });
  return rewriter
    .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();
}

export async function handlePostContent(request, env, postId, fetchImpl = fetch, cacheImpl) {
  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(request, 403, { ok: false, error: GENERIC_ERROR });
  }
  if (request.method !== "GET") {
    return jsonResponse(request, 405, { ok: false, error: GENERIC_ERROR });
  }
  const cache = getCacheStore(cacheImpl);

  // The newest issue is open to everyone so the welcome email's
  // "Read the newest issue" link never hits a gate or a login wall.
  if (postId === "latest") {
    const posts = await loadPublishedPosts(env, fetchImpl, cache);
    if (!posts) return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
    if (!posts.length) {
      return jsonResponse(request, 404, { ok: false, error: "We couldn't find that issue." });
    }
    postId = posts[0].id;
  } else if (!(await verifyReadToken(env, bearerToken(request)))) {
    return jsonResponse(request, 401, { ok: false, error: "Join the list to read this issue." });
  }
  if (!postIdIsSafe(postId)) {
    return jsonResponse(request, 404, { ok: false, error: "We couldn't find that issue." });
  }

  const cacheKey = new Request(POST_CACHE_PREFIX + postId.toLowerCase());
  const cached = await cacheGetJson(cache, cacheKey);
  if (cached && cached.id === postId) {
    return jsonResponse(request, 200, { ok: true, post: cached });
  }

  const config = serverConfig(env);
  if (!config) {
    console.error("post is missing its server configuration");
    return jsonResponse(request, 500, { ok: false, error: GENERIC_ERROR });
  }

  let response;
  try {
    response = await beehiivGet(
      config,
      "/publications/" +
        encodeURIComponent(config.publicationId) +
        "/posts/" +
        encodeURIComponent(postId) +
        "?expand%5B%5D=free_web_content",
      fetchImpl
    );
  } catch {
    console.error("post request failed");
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }
  if (response.status === 404) {
    return jsonResponse(request, 404, { ok: false, error: "We couldn't find that issue." });
  }
  if (!response.ok) {
    console.error("post upstream status " + response.status);
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }

  let post;
  try {
    post = (await response.json()).data;
  } catch {
    return jsonResponse(request, 502, { ok: false, error: GENERIC_ERROR });
  }
  if (!post || post.id !== postId || !isPublishedWebPost(post, Date.now())) {
    return jsonResponse(request, 404, { ok: false, error: "We couldn't find that issue." });
  }
  const rawHtml =
    post.content && post.content.free && typeof post.content.free.web === "string"
      ? post.content.free.web
      : "";
  if (!rawHtml) {
    return jsonResponse(request, 404, { ok: false, error: "We couldn't find that issue." });
  }

  const result = { ...postSummary(post), html: await sanitizePostHtml(rawHtml) };
  await cachePutJson(cache, cacheKey, result, POSTS_CACHE_SECONDS);
  return jsonResponse(request, 200, { ok: true, post: result });
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
