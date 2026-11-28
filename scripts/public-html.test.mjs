import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
const archive = await readFile(new URL("../archive/index.html", import.meta.url), "utf8");
const issue = await readFile(new URL("../issue/index.html", import.meta.url), "utf8");
const latest = await readFile(new URL("../latest/index.html", import.meta.url), "utf8");
const missing = await readFile(new URL("../404.html", import.meta.url), "utf8");
const robots = await readFile(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");
const join = await readFile(new URL("../join.js", import.meta.url), "utf8");
const favicon = await readFile(new URL("../favicon.ico", import.meta.url));

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1])
  );
}

test("homepage is crawlable and the signup form is intact", () => {
  assert.match(home, /<title>Tarmac Time — Business Aviation News &amp; Pilot Jobs Newsletter<\/title>/);
  assert.match(
    home,
    /A free letter for pilots and aviation professionals, every other week\. Business aviation news, pilot jobs by time, and a look beyond the cockpit\./
  );
  assert.match(home, /class="site-kicker">A business aviation news and pilot jobs newsletter</);
  assert.match(home, /A short list <em>worth your time\.<\/em>/);
  assert.match(home, /alt="Tarmac Time, business aviation careers"/);
  assert.match(home, /id="join-form"/);
  assert.match(home, /name="email"/);
  assert.match(home, /src="join\.js"/);
  assert.doesNotMatch(home, /Loading issues/);
  assert.match(home, /class="issue-title"/);
  assert.match(home, /class="issue-date"/);
  assert.match(home, /href="\/archive\/"/);
  assert.doesNotMatch(home, /beehiiv\.com\/p\//);

  const blocks = jsonLdBlocks(home);
  const graph = blocks.find((block) => Array.isArray(block["@graph"]))["@graph"];
  assert.deepEqual(
    graph.map((node) => node["@type"]).sort(),
    ["Organization", "Periodical", "WebSite"]
  );
  const list = blocks.find((block) => block["@type"] === "ItemList");
  assert.ok(list.numberOfItems >= 1);
  assert.equal(list.itemListElement[0].item["@type"], "PublicationIssue");
  assert.equal(list.itemListElement[0].item.isAccessibleForFree, false);
  assert.equal(typeof list.itemListElement[0].item.name, "string");
});

test("archive lists the same public issues and issue pages stay gated", () => {
  assert.match(archive, /<link rel="canonical" href="https:\/\/tarmactime\.com\/archive\/"/);
  assert.match(archive, /<h1>Past issues<\/h1>/);
  assert.match(archive, /class="issue-title"/);
  assert.match(archive, /src="\/gate\.js"/);
  assert.doesNotMatch(archive, /noindex/);
  assert.doesNotMatch(archive, /Loading issues/);
  assert.equal(jsonLdBlocks(archive).some((block) => block["@type"] === "CollectionPage"), true);
  assert.match(issue, /<meta name="robots" content="noindex"/);
  assert.match(latest, /<meta name="robots" content="noindex"/);
  assert.match(missing, /<meta name="robots" content="noindex"/);
  assert.match(missing, /<h1>That page is not <em>on the list\.<\/em><\/h1>/);
  assert.match(missing, /href="\/"/);
});

test("robots and sitemap name the public pages", () => {
  assert.match(robots, /content signals/);
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Disallow:/);
  assert.match(robots, /Sitemap: https:\/\/tarmactime\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/tarmactime\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/tarmactime\.com\/archive\/<\/loc>/);
  assert.doesNotMatch(sitemap, /\/issue\//);
  assert.doesNotMatch(sitemap, /\/latest\//);
  assert.equal(favicon.subarray(0, 4).toString("hex"), "00000100");
  assert.match(join, /https:\/\/tarmactime-signup\.tarmactime\.workers\.dev\//);
});
