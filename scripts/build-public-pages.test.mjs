import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIssueJsonLd,
  applyIssueMarkers,
  escapeHtml,
  formatIssueDate,
  normalizePosts,
  renderPublicFiles,
  renderSitemap,
} from "./build-public-pages.mjs";

const POSTS = [
  {
    id: "post_3f5f31c3-e5b5-4055-aa33-3e8bc8cc4ae1",
    title: "Happy Thanksgiving from Tarmac Time",
    subtitle: "Roles for pilots & crew",
    publish_date: "2026-11-24T16:00:00.000Z",
    thumbnail_url: "https://example.com/thanks.png?t=1",
    web_url: "https://tarmactime.beehiiv.com/p/happy-thanksgiving-from-tarmac-time",
    html: "<p>Gated body that must stay off the public page.</p>",
  },
  {
    id: "not-a-post",
    title: "Skip me",
    publish_date: "2026-11-25T16:00:00.000Z",
  },
  {
    id: "post_319ebd95-7021-461d-9516-2b80da606c03",
    title: 'Welcome <script>alert("x")</script>',
    subtitle: "",
    publish_date: "2026-05-22T01:27:40.000Z",
    thumbnail_url: "javascript:alert(1)",
  },
];

const PAGE = `<!DOCTYPE html>
<html>
  <head>
    <title>Keep me</title>
    <script type="application/ld+json" id="issue-list-jsonld">
    </script>
  </head>
  <body>
    <form id="join-form"></form>
    <ol id="issue-list">
        <!-- issues:start -->
        <li class="issue-empty">Loading issues…</li>
        <!-- issues:end -->
    </ol>
  </body>
</html>
`;

test("formats issue dates in Phoenix time", () => {
  assert.equal(formatIssueDate("2026-11-24T16:00:00.000Z"), "Nov 24, 2026");
  assert.equal(formatIssueDate("not-a-date"), "");
});

test("escapes text that could break HTML", () => {
  assert.equal(escapeHtml(`a & b <c> "d"`), "a &amp; b &lt;c&gt; &quot;d&quot;");
});

test("keeps only safe public fields and drops gated bodies", () => {
  const posts = normalizePosts(POSTS);
  assert.deepEqual(
    posts.map((post) => post.id),
    [
      "post_3f5f31c3-e5b5-4055-aa33-3e8bc8cc4ae1",
      "post_319ebd95-7021-461d-9516-2b80da606c03",
    ]
  );
  assert.equal("html" in posts[0], false);
  assert.equal("web_url" in posts[0], false);
  assert.equal(posts[1].thumbnail_url, "");
});

test("writes titles into the initial HTML without touching the signup form", () => {
  const html = applyIssueMarkers(PAGE, POSTS);
  assert.match(html, /Happy Thanksgiving from Tarmac Time/);
  assert.match(html, /Nov 24, 2026/);
  assert.match(html, /Roles for pilots &amp; crew/);
  assert.match(html, /href="\/issue\/\?id=post_3f5f31c3-e5b5-4055-aa33-3e8bc8cc4ae1"/);
  assert.match(html, /Welcome &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /Gated body/);
  assert.doesNotMatch(html, /beehiiv\.com/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.doesNotMatch(html, /Loading issues/);
  assert.match(html, /<form id="join-form"><\/form>/);
  assert.match(html, /<title>Keep me<\/title>/);
  assert.equal(applyIssueMarkers(html, POSTS), html);
});

test("adds publication issues as JSON-LD and a sitemap of indexable pages", () => {
  const html = applyIssueJsonLd(PAGE, POSTS);
  const json = JSON.parse(html.match(/<script[^>]*id="issue-list-jsonld">([\s\S]*?)<\/script>/)[1]);
  assert.equal(json["@type"], "ItemList");
  assert.equal(json.numberOfItems, 2);
  assert.equal(json.itemListElement[0].item["@type"], "PublicationIssue");
  assert.equal(json.itemListElement[0].item.isAccessibleForFree, false);
  assert.equal(json.itemListElement[0].item.name, "Happy Thanksgiving from Tarmac Time");
  assert.doesNotMatch(html, /Gated body/);

  const rendered = renderPublicFiles(PAGE, PAGE, POSTS);
  assert.match(rendered.sitemap, /<loc>https:\/\/tarmactime\.com\/<\/loc>/);
  assert.match(rendered.sitemap, /<loc>https:\/\/tarmactime\.com\/archive\/<\/loc>/);
  assert.match(rendered.sitemap, /<lastmod>2026-11-24<\/lastmod>/);
  assert.doesNotMatch(rendered.sitemap, /\/issue\//);
  assert.doesNotMatch(rendered.sitemap, /\/latest\//);
  assert.match(rendered.indexHtml, /id="join-form"/);
  assert.match(rendered.archiveHtml, /Happy Thanksgiving from Tarmac Time/);
});

test("sitemap omits lastmod when there are no issues", () => {
  const xml = renderSitemap([]);
  assert.match(xml, /tarmactime\.com\/archive\//);
  assert.doesNotMatch(xml, /lastmod/);
});
