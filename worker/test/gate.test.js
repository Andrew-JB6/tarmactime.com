import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, issueReadToken, verifyReadToken, pickPublishedWebPosts } from "../src/index.js";

const ENV = {
  BEEHIIV_PUBLICATION_ID: "pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06",
  BEEHIIV_API_KEY: "test-key-not-real",
  GATE_SECRET: "x".repeat(48),
};
const NOW = Date.parse("2026-11-23T21:00:00-07:00");

test("tokens verify, expire, and reject tampering or another secret", async () => {
  const token = await issueReadToken(ENV, NOW);
  assert.equal(await verifyReadToken(ENV, token, NOW), true);
  assert.equal(await verifyReadToken(ENV, token, NOW + 31 * 86400e3), false);
  assert.equal(await verifyReadToken({ GATE_SECRET: "y".repeat(48) }, token, NOW), false);
  const [body, sig] = token.split(".");
  assert.equal(await verifyReadToken(ENV, body + "A." + sig, NOW), false);
  assert.equal(await verifyReadToken(ENV, "", NOW), false);
});

test("lists only confirmed, already-published, web posts", () => {
  const base = { status: "confirmed", platform: "both", audience: "free" };
  const posts = pickPublishedWebPosts(
    {
      data: [
        { ...base, id: "post_3f5f31c3-e5b5-4055-aa33-3e8bc8cc4ae1", title: "Thanks", publish_date: 1795536000, web_url: "https://tarmactime.beehiiv.com/p/thanks" },
        { ...base, id: "post_f823125b-f039-4e75-b1e7-798dc043bfb1", title: "Vision", publish_date: 1784660078, web_url: "https://tarmactime.beehiiv.com/p/vision" },
        { ...base, id: "post_c784990c-3fbb-4d57-8a88-adeab0756b86", status: "draft", publish_date: 1, web_url: "https://tarmactime.beehiiv.com/p/d" },
        { ...base, id: "post_d6ab3d6c-635c-4a68-a3e4-e4157d16face", platform: "email", publish_date: 1784053622, web_url: "https://tarmactime.beehiiv.com/p/e" },
      ],
    },
    NOW
  );
  assert.deepEqual(posts.map((p) => p.title), ["Vision"]);
  assert.equal("html" in posts[0], false);
});

test("gated content rejects missing or bad tokens", async () => {
  const req = (auth) =>
    new Request("https://w.example/post/post_f823125b-f039-4e75-b1e7-798dc043bfb1", {
      headers: auth ? { Authorization: auth } : {},
    });
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error("no"); };
  assert.equal((await handleRequest(req(), ENV, fetchImpl, null)).status, 401);
  assert.equal((await handleRequest(req("Bearer abc.def"), ENV, fetchImpl, null)).status, 401);
  assert.equal(called, false);
});

test("access requires an allowed origin", async () => {
  const r = new Request("https://w.example/access", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.co" }),
  });
  const res = await handleRequest(r, ENV, async () => { throw new Error("no"); }, null);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});
