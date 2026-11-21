"use strict";

var GENERIC_ERROR = "Something went wrong. Please try again.";
var EMAIL_ERROR = "Check the email address and try again.";
var EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function fail(status, error) {
  return { status: status, body: { ok: false, error: error } };
}

function ok() {
  return { status: 200, body: { ok: true } };
}

function readBody(body) {
  if (body == null || body === "") return {};
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    body = body.toString("utf8");
  }
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return null;
    }
  }
  if (typeof body !== "object" || Array.isArray(body)) return null;
  return body;
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  var local = email.split("@")[0];
  if (!local || local.length > 64) return false;
  if (email.indexOf("..") !== -1) return false;
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

async function handleSubscribe(request, deps) {
  var method = request && request.method ? String(request.method).toUpperCase() : "";
  if (method !== "POST") {
    return fail(405, GENERIC_ERROR);
  }

  var payload = readBody(request.body);
  if (!payload) return fail(400, EMAIL_ERROR);

  if (honeypotTripped(payload.company)) {
    return ok();
  }

  var email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) return fail(400, EMAIL_ERROR);

  var environment = (deps && deps.env) || process.env;
  var publicationId = environment.BEEHIIV_PUBLICATION_ID;
  var apiKey = environment.BEEHIIV_API_KEY;
  if (!publicationIdIsSafe(publicationId) || typeof apiKey !== "string" || !apiKey.trim()) {
    console.error("subscribe is missing its server configuration");
    return fail(500, GENERIC_ERROR);
  }

  var body = {
    email: email,
    reactivate_existing: false,
    send_welcome_email: true,
    utm_source: "tarmactime.com",
    referring_site: "https://tarmactime.com",
  };

  var firstName = cleanName(payload.first_name);
  if (firstName) {
    body.custom_fields = [{ name: "first_name", value: firstName }];
  }

  var fetchImpl = (deps && deps.fetchImpl) || fetch;
  var url =
    "https://api.beehiiv.com/v2/publications/" +
    encodeURIComponent(publicationId) +
    "/subscriptions";

  var response;
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
  } catch (err) {
    console.error("subscribe request failed");
    return fail(502, GENERIC_ERROR);
  }

  if (!response.ok) {
    console.error("subscribe upstream status " + response.status);
    return fail(502, GENERIC_ERROR);
  }

  return ok();
}

async function handler(req, res) {
  try {
    var result = await handleSubscribe({ method: req.method, body: req.body });
    res.setHeader("Cache-Control", "no-store");
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("subscribe handler failed");
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, error: GENERIC_ERROR });
  }
}

module.exports = handler;
module.exports.handleSubscribe = handleSubscribe;
