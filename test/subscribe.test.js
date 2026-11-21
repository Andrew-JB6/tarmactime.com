"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var { handleSubscribe } = require("../api/subscribe");

var PUBLICATION_ID = "pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06";
var API_KEY = "test-key-not-real";

function env(overrides) {
  return Object.assign(
    {
      BEEHIIV_PUBLICATION_ID: PUBLICATION_ID,
      BEEHIIV_API_KEY: API_KEY,
    },
    overrides
  );
}

function mockFetch(status, responseBody) {
  var calls = [];
  var impl = async function (url, options) {
    calls.push({ url: url, options: options });
    return {
      ok: status >= 200 && status < 300,
      status: status,
      async text() {
        return JSON.stringify(responseBody || {});
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function post(body, fetchImpl, environment) {
  return handleSubscribe(
    { method: "POST", body: body },
    { fetchImpl: fetchImpl, env: environment || env() }
  );
}

test("creates a subscription with the documented beehiiv fields", async function () {
  var fetchImpl = mockFetch(200, { data: { id: "sub_1", status: "active" } });
  var result = await post(
    { email: " Pilot@Example.com ", first_name: "  Ada ", company: "" },
    fetchImpl
  );

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(fetchImpl.calls.length, 1);
  var call = fetchImpl.calls[0];
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

test("omits custom fields when first name is blank", async function () {
  var fetchImpl = mockFetch(200, { data: { id: "sub_2" } });
  var result = await post({ email: "pilot@example.com", first_name: "   " }, fetchImpl);

  assert.equal(result.status, 200);
  var body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.email, "pilot@example.com");
  assert.equal(Object.hasOwn(body, "custom_fields"), false);
});

test("rejects an invalid email before calling beehiiv", async function () {
  var fetchImpl = mockFetch(200, {});
  var result = await post({ email: "not-an-email" }, fetchImpl);

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "Check the email address and try again.");
  assert.equal(fetchImpl.calls.length, 0);
});

test("treats a filled honeypot as success and does not call beehiiv", async function () {
  var fetchImpl = mockFetch(200, {});
  var result = await post(
    { email: "pilot@example.com", company: "Acme Bots" },
    fetchImpl
  );

  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(fetchImpl.calls.length, 0);
});

test("does not leak upstream errors to the visitor", async function () {
  var upstream = {
    errors: [{ message: "SECRET_UPSTREAM_DETAIL invalid publication key", code: "unauthorized" }],
  };
  var fetchImpl = mockFetch(401, upstream);
  var result = await post({ email: "pilot@example.com" }, fetchImpl);

  assert.equal(result.status, 502);
  assert.equal(result.body.error, "Something went wrong. Please try again.");
  assert.equal(JSON.stringify(result.body).includes("SECRET_UPSTREAM_DETAIL"), false);
  assert.equal(JSON.stringify(result.body).includes(API_KEY), false);
});

test("returns a generic error when the upstream request throws", async function () {
  var fetchImpl = async function () {
    throw new Error("SECRET network detail");
  };
  var result = await post({ email: "pilot@example.com" }, fetchImpl);
  assert.equal(result.status, 502);
  assert.equal(JSON.stringify(result.body).includes("SECRET"), false);
});

test("returns a generic error when configuration is missing", async function () {
  var fetchImpl = mockFetch(200, {});
  var result = await post({ email: "pilot@example.com" }, fetchImpl, {
    BEEHIIV_PUBLICATION_ID: PUBLICATION_ID,
    BEEHIIV_API_KEY: "  ",
  });

  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Something went wrong. Please try again.");
  assert.equal(fetchImpl.calls.length, 0);
});

test("rejects methods other than POST", async function () {
  var fetchImpl = mockFetch(200, {});
  var result = await handleSubscribe(
    { method: "GET", body: { email: "pilot@example.com" } },
    { fetchImpl: fetchImpl, env: env() }
  );
  assert.equal(result.status, 405);
  assert.equal(fetchImpl.calls.length, 0);
});

test("keeps a subscription that beehiiv accepted with warnings", async function () {
  var fetchImpl = mockFetch(200, {
    data: { id: "sub_3", status: "pending" },
    warnings: [{ message: "unknown custom field dropped", code: "custom_field" }],
  });
  var result = await post({ email: "pilot@example.com", first_name: "Ada" }, fetchImpl);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(JSON.stringify(result.body).includes("unknown custom field"), false);
});
