#!/usr/bin/env node
// Writes public issue titles, dates, and subtitles into the homepage and
// archive, plus sitemap.xml. Issue bodies stay gated and are not requested.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const POSTS_URL = "https://tarmactime-signup.tarmactime.workers.dev/posts";
const SITE = "https://tarmactime.com";
const POST_ID =
  /^post_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function safeThumb(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function formatIssueDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Phoenix",
  }).format(date);
}

export function normalizePosts(posts) {
  if (!Array.isArray(posts)) return [];
  const usable = [];
  for (const post of posts) {
    if (!post || typeof post !== "object") continue;
    if (typeof post.id !== "string" || !POST_ID.test(post.id)) continue;
    const title = cleanText(post.title);
    if (!title) continue;
    const published = Date.parse(post.publish_date);
    if (Number.isNaN(published)) continue;
    usable.push({
      id: post.id,
      title,
      subtitle: cleanText(post.subtitle),
      publish_date: new Date(published).toISOString(),
      thumbnail_url: safeThumb(post.thumbnail_url),
    });
  }
  usable.sort((a, b) => Date.parse(b.publish_date) - Date.parse(a.publish_date));
  return usable;
}

function renderIssueItem(post) {
  const href = "/issue/?id=" + encodeURIComponent(post.id);
  const thumb = post.thumbnail_url
    ? `            <img class="issue-thumb" src="${escapeHtml(post.thumbnail_url)}" alt="" width="96" height="54" loading="lazy" decoding="async" />\n`
    : "";
  const subtitle = post.subtitle
    ? `              <span class="issue-sub">${escapeHtml(post.subtitle)}</span>\n`
    : "";
  return (
    `        <li class="issue">\n` +
    `          <a class="issue-link" href="${href}" data-id="${escapeHtml(post.id)}">\n` +
    thumb +
    `            <span class="issue-text">\n` +
    `              <span class="issue-date">${escapeHtml(formatIssueDate(post.publish_date))}</span>\n` +
    `              <span class="issue-title">${escapeHtml(post.title)}</span>\n` +
    subtitle +
    `            </span>\n` +
    `          </a>\n` +
    `        </li>`
  );
}

export function renderIssueListHtml(posts) {
  const usable = normalizePosts(posts);
  if (!usable.length) {
    return `        <li class="issue-empty">The first issue is on its way.</li>`;
  }
  return usable.map(renderIssueItem).join("\n");
}

export function issueListJsonLd(posts) {
  const usable = normalizePosts(posts);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Past issues of Tarmac Time",
    numberOfItems: usable.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: usable.map((post, index) => {
      const item = {
        "@type": "PublicationIssue",
        name: post.title,
        datePublished: post.publish_date,
        isAccessibleForFree: false,
        isPartOf: { "@id": `${SITE}/#newsletter` },
      };
      if (post.subtitle) item.description = post.subtitle;
      return { "@type": "ListItem", position: index + 1, item };
    }),
  };
}

export function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function replaceMarked(html, start, end, inner) {
  const startAt = html.indexOf(start);
  const endAt = html.indexOf(end, startAt + start.length);
  if (startAt < 0 || endAt < 0) {
    throw new Error(`Missing markers ${start} … ${end}`);
  }
  return html.slice(0, startAt + start.length) + "\n" + inner + "\n        " + html.slice(endAt);
}

export function applyIssueMarkers(html, posts) {
  return replaceMarked(html, "<!-- issues:start -->", "<!-- issues:end -->", renderIssueListHtml(posts));
}

export function applyIssueJsonLd(html, posts) {
  const pattern =
    /(<script\s+type="application\/ld\+json"\s+id="issue-list-jsonld">)[\s\S]*?(<\/script>)/;
  if (!pattern.test(html)) {
    throw new Error("Missing issue list JSON-LD block.");
  }
  return html.replace(pattern, `$1\n${jsonForScript(issueListJsonLd(posts))}\n    $2`);
}

export function renderSitemap(posts) {
  const usable = normalizePosts(posts);
  const lastmod = usable.length ? usable[0].publish_date.slice(0, 10) : "";
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url>\n` +
    `    <loc>${SITE}/</loc>${lastmodTag}\n` +
    `  </url>\n` +
    `  <url>\n` +
    `    <loc>${SITE}/archive/</loc>${lastmodTag}\n` +
    `  </url>\n` +
    `</urlset>\n`
  );
}

export function renderPublicFiles(indexHtml, archiveHtml, posts) {
  return {
    indexHtml: applyIssueJsonLd(applyIssueMarkers(indexHtml, posts), posts),
    archiveHtml: applyIssueJsonLd(applyIssueMarkers(archiveHtml, posts), posts),
    sitemap: renderSitemap(posts),
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const response = await fetch(POSTS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error("Posts list request failed with status " + response.status);
  }
  const data = await response.json();
  if (!data || data.ok !== true || !Array.isArray(data.posts)) {
    throw new Error("Posts list payload was not a public issue list.");
  }

  const indexPath = path.join(root, "index.html");
  const archivePath = path.join(root, "archive", "index.html");
  const rendered = renderPublicFiles(
    await readFile(indexPath, "utf8"),
    await readFile(archivePath, "utf8"),
    data.posts
  );
  await writeFile(indexPath, rendered.indexHtml);
  await writeFile(archivePath, rendered.archiveHtml);
  await writeFile(path.join(root, "sitemap.xml"), rendered.sitemap);
  const count = normalizePosts(data.posts).length;
  console.log(`Wrote ${count} public ${count === 1 ? "issue" : "issues"} into the homepage, archive, and sitemap.`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}
