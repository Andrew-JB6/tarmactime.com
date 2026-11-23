import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/index.js";

const PUBLICATION_ID = "pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06";
const API_KEY = "test-key-not-real";
const ALLOWED = "https://tarmactime.com";

function env(overrides) {
  return {
    BEEHIIV_PUBLICATION_ID: PUBLICATION_ID,
    BEEHIIV_API_KEY: API_KEY,
    ...overrides,
  };
}

function mockFetch(status, responseBody) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(responseBody || {});
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function request(body, { method = "POST", origin } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request("https://tarmactime-signup.example.workers.dev/", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function post(body, fetchImpl, environment, origin) {
  const response = await handleRequest(
    request(body, { origin }),
    environment || env(),
    fetchImpl
  );
  return {
    status: response.status,
    body: await response.json(),
    allowOrigin: response.headers.get("Access-Control-Allow-Origin"),
  };
}

test("creates a subscription with the documented beehiiv fields", async () => {
  const fetchImpl = mockFetch(200, { data: { id: "sub_1", status: "active" } });
  const result = await post(
    { email: " Pilot@Example.com ", first_name: "  Ada ", company: "" },
    fetchImpl,
    undefined,
    ALLOWED
  );

  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.status, 200);
  assert.equal(result.allowOrigin, ALLOWED);
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(
    call.url,
    "https://api.beehiiv.com/v2/publications/" + PUBLICATION_ID + "/subscriptions"
  );
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.Authorization, "Bearer " + API_KEY);
  assert.deepEqual(JSON.parse(call.options.body), {
    email: "pilot@example.com",
    reactivate_existing: false,
    send_welcome_email: true,
    utm_source: "tarmactime.com",
    referring_site: "https://tarmactime.com",
    custom_fields: [{ name: "first_name", value: "Ada" }],
  });
});

test("omits custom fields when first name is blank", async () => {
  const fetchImpl = mockFetch(200, { data: { id: "sub_2" } });
  const result = await post({ email: "pilot@example.com", first_name: "   " }, fetchImpl);

  assert.equal(result.status, 200);
  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.email, "pilot@example.com");
  assert.equal(Object.hasOwn(body, "custom_fields"), false);
});

test("rejects an invalid email before calling beehiiv", async () => {
  const fetchImpl = mockFetch(200, {});
  const result = await post({ email: "not-an-email" }, fetchImpl);

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "Check the email address and try again.");
  assert.equal(fetchImpl.calls.length, 0);
});

test("treats a filled honeypot as success and does not call beehiiv", async () => {
  const fetchImpl = mockFetch(200, {});
  const result = await post({ email: "pilot@example.com", company: "Acme Bots" }, fetchImpl);

  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.status, 200);
  assert.equal(fetchImpl.calls.length, 0);
});

test("does not leak upstream errors to the visitor", async () => {
  const upstream = {
    errors: [{ message: "SECRET_UPSTREAM_DETAIL invalid publication key", code: "unauthorized" }],
  };
  const fetchImpl = mockFetch(401, upstream);
  const result = await post({ email: "pilot@example.com" }, fetchImpl);

  assert.equal(result.status, 502);
  assert.equal(result.body.error, "Something went wrong. Please try again.");
  assert.equal(JSON.stringify(result.body).includes("SECRET_UPSTREAM_DETAIL"), false);
  assert.equal(JSON.stringify(result.body).includes(API_KEY), false);
});

test("returns a generic error when the upstream request throws", async () => {
  const fetchImpl = async () => {
    throw new Error("SECRET network detail");
  };
  const result = await post({ email: "pilot@example.com" }, fetchImpl);
  assert.equal(result.status, 502);
  assert.equal(JSON.stringify(result.body).includes("SECRET"), false);
});

test("returns a generic error when configuration is missing", async () => {
  const fetchImpl = mockFetch(200, {});
  const result = await post({ email: "pilot@example.com" }, fetchImpl, {
    BEEHIIV_PUBLICATION_ID: PUBLICATION_ID,
    BEEHIIV_API_KEY: "  ",
  });

  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Something went wrong. Please try again.");
  assert.equal(fetchImpl.calls.length, 0);
});

test("rejects methods other than POST", async () => {
  const fetchImpl = mockFetch(200, {});
  const response = await handleRequest(request(undefined, { method: "GET" }), env(), fetchImpl);
  assert.equal(response.status, 405);
  assert.equal(fetchImpl.calls.length, 0);
});

test("keeps a subscription that beehiiv accepted with warnings", async () => {
  const fetchImpl = mockFetch(200, {
    data: { id: "sub_3", status: "pending" },
    warnings: [{ message: "unknown custom field dropped", code: "custom_field" }],
  });
  const result = await post({ email: "pilot@example.com", first_name: "Ada" }, fetchImpl);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(JSON.stringify(result.body).includes("unknown custom field"), false);
});

test("answers a preflight from the site and from www", async () => {
  for (const origin of ["https://tarmactime.com", "https://www.tarmactime.com"]) {
    const response = await handleRequest(
      request(undefined, { method: "OPTIONS", origin }),
      env(),
      mockFetch(200, {})
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
    assert.match(response.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  }
});

test("refuses a preflight and a post from any other origin", async () => {
  const fetchImpl = mockFetch(200, {});
  const preflight = await handleRequest(
    request(undefined, { method: "OPTIONS", origin: "https://example.com" }),
    env(),
    fetchImpl
  );
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), null);

  const posted = await post(
    { email: "pilot@example.com" },
    fetchImpl,
    undefined,
    "https://andrew-jb6.github.io"
  );
  assert.equal(posted.status, 403);
  assert.equal(posted.allowOrigin, null);
  assert.equal(fetchImpl.calls.length, 0);
});
