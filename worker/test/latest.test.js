import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, pickLatestWebUrl } from "../src/index.js";

const PUBLICATION_ID = "pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06";
const API_KEY = "test-key-not-real";
const POSTS_URL =
  "https://api.beehiiv.com/v2/publications/" +
  PUBLICATION_ID +
  "/posts?status=confirmed&order_by=publish_date&direction=desc&limit=25";
const CRITERIA = "https://tarmactime.beehiiv.com/p/tarmac-time-criteria";
const VISION = "https://tarmactime.beehiiv.com/p/from-vision-jets-to-king-airs-this-week-s-pilot-jobs";
const THANKS = "https://tarmactime.beehiiv.com/p/happy-thanksgiving-from-tarmac-time";
const FALLBACK = "https://tarmactime.beehiiv.com/";
const NOW = Date.parse("2026-11-23T20:30:00-07:00");

function env(overrides) {
  return {
    BEEHIIV_PUBLICATION_ID: PUBLICATION_ID,
    BEEHIIV_API_KEY: API_KEY,
    ...overrides,
  };
}

function mockFetch(status, responseBody, { throwOnCall = false } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (throwOnCall) throw new Error("SECRET network detail");
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return responseBody;
      },
      async text() {
        return JSON.stringify(responseBody || {});
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function memoryCache() {
  const store = new Map();
  return {
    async match(request) {
      return store.get(String(request.url)) || null;
    },
    async put(request, response) {
      store.set(String(request.url), response);
    },
    store,
  };
}

function latestRequest({ method = "GET", origin, url } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  return new Request(url || "https://tarmactime-signup.tarmactime.workers.dev/latest", {
    method,
    headers,
  });
}

async function latest(fetchImpl, { method, origin, environment, cache, url } = {}) {
  const response = await handleRequest(
    latestRequest({ method, origin, url }),
    environment || env(),
    fetchImpl,
    cache
  );
  return {
    status: response.status,
    location: response.headers.get("Location"),
    cacheControl: response.headers.get("Cache-Control"),
    allowOrigin: response.headers.get("Access-Control-Allow-Origin"),
    body: await response.text(),
  };
}

const samplePayload = {
  data: [
    {
      title: "Happy Thanksgiving from Tarmac Time",
      platform: "both",
      publish_date: Date.parse("2026-11-24T16:00:00Z") / 1000,
      web_url: THANKS,
    },
    {
      title: "From Vision Jets to King Airs: This Week's Pilot Jobs",
      platform: "both",
      publish_date: Date.parse("2026-07-21T18:54:38Z") / 1000,
      web_url: VISION,
    },
    {
      title: "Tarmac Time Criteria",
      platform: "both",
      publish_date: Date.parse("2026-07-08T20:56:53Z") / 1000,
      web_url: CRITERIA,
    },
  ],
};

test("picks the newest already-published web post and skips a future scheduled issue", () => {
  assert.equal(pickLatestWebUrl(samplePayload, NOW), VISION);
});

test("skips email-only posts and unsafe redirect targets", () => {
  const payload = {
    data: [
      {
        platform: "email",
        publish_date: NOW / 1000 - 60,
        web_url: "https://tarmactime.beehiiv.com/p/email-only",
      },
      {
        platform: "both",
        publish_date: NOW / 1000 - 120,
        web_url: "https://evil.example/phish",
      },
      {
        platform: "web",
        publish_date: NOW / 1000 - 180,
        url: CRITERIA,
      },
    ],
  };
  assert.equal(pickLatestWebUrl(payload, NOW), CRITERIA);
});

test("redirects GET /latest to the newest published post and queries beehiiv correctly", async () => {
  const fetchImpl = mockFetch(200, samplePayload);
  const result = await latest(fetchImpl);
  assert.equal(result.status, 302);
  assert.equal(result.location, VISION);
  assert.equal(result.cacheControl, "public, max-age=300");
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, POSTS_URL);
  assert.equal(fetchImpl.calls[0].options.method, "GET");
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, "Bearer " + API_KEY);
  assert.equal(result.body, "");
});

test("treats /latest/ the same as /latest and answers HEAD", async () => {
  const fetchImpl = mockFetch(200, samplePayload);
  const slashed = await latest(fetchImpl, {
    url: "https://tarmactime-signup.tarmactime.workers.dev/latest/",
  });
  const headed = await latest(fetchImpl, { method: "HEAD" });
  assert.equal(slashed.status, 302);
  assert.equal(slashed.location, VISION);
  assert.equal(headed.status, 302);
  assert.equal(headed.location, VISION);
});

test("falls back to the publication home on errors and does not leak secrets", async () => {
  const cases = [
    await latest(mockFetch(200, samplePayload, { throwOnCall: true })),
    await latest(mockFetch(401, { errors: [{ message: "SECRET_UPSTREAM_DETAIL" }] })),
    await latest(mockFetch(200, { data: [] })),
    await latest(mockFetch(200, samplePayload), {
      environment: { BEEHIIV_PUBLICATION_ID: PUBLICATION_ID, BEEHIIV_API_KEY: "  " },
    }),
  ];
  for (const result of cases) {
    assert.equal(result.status, 302);
    assert.equal(result.location, FALLBACK);
    assert.equal(result.cacheControl, "no-store");
    assert.equal(result.body.includes("SECRET"), false);
    assert.equal(result.body.includes(API_KEY), false);
  }
});

test("does not apply signup CORS rules to /latest and still rejects a GET on the signup path", async () => {
  const fetchImpl = mockFetch(200, samplePayload);
  const redirected = await latest(fetchImpl, { origin: "https://example.com" });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.location, VISION);
  assert.equal(redirected.allowOrigin, null);

  const signupGet = await handleRequest(
    new Request("https://tarmactime-signup.tarmactime.workers.dev/", { method: "GET" }),
    env(),
    fetchImpl
  );
  assert.equal(signupGet.status, 405);
  assert.equal(JSON.parse(await signupGet.text()).ok, false);
});

test("reuses a cached latest URL without calling beehiiv again", async () => {
  const fetchImpl = mockFetch(200, samplePayload);
  const cache = memoryCache();
  const first = await latest(fetchImpl, { cache });
  const second = await latest(fetchImpl, { cache });
  assert.equal(first.location, VISION);
  assert.equal(second.location, VISION);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(cache.store.size, 1);
});
