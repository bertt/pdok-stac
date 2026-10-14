// Build a static STAC catalog from https://api.pdok.nl/index.json (no HTML scraping).
// For every API in the index the OGC API landing page and /collections are read
// for license, preview, keywords and the real spatial/temporal extent.
//
// Output (relative links only, so it can be hosted on GitHub Pages):
//   catalog/catalog.json
//   catalog/collections/<id>/collection.json
//   catalog/index.html
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_URL = "https://api.pdok.nl/index.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "catalog");
const NL_BBOX = [3.2, 50.75, 7.22, 53.7];
const STAC_VERSION = "1.0.0";
const PROVIDERS = {
  kadaster: "Kadaster",
  cbs: "CBS",
  rvo: "RVO",
  rws: "Rijkswaterstaat",
  hwh: "Het Waterschapshuis",
  ienw: "Ministerie van Infrastructuur en Waterstaat",
  tno: "TNO",
  rce: "Rijksdienst voor het Cultureel Erfgoed",
  kvk: "Kamer van Koophandel",
  rioned: "RIONED",
  prorail: "ProRail",
  defensie: "Defensie",
  brt: "Kadaster",
  lv: "Kadaster",
  bzk: "Kadaster",
};

async function fetchJson(url) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

async function tryJson(url) {
  try {
    return await fetchJson(url);
  } catch (e) {
    console.error(`skipped ${url}: ${e.message}`);
    return null;
  }
}

const slug = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const pathOf = (root) => root.split("api.pdok.nl/")[1] ?? root;
const providerOf = (root) => {
  const key = pathOf(root).split("/")[0];
  return PROVIDERS[key] ?? key.toUpperCase();
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkByRel = (doc, rel) => (doc?.links ?? []).find((l) => l.rel === rel);
const keywordsOf = (doc) =>
  (doc?.keywords ?? []).map((k) => (typeof k === "string" ? k : k.keyword)).filter(Boolean);

// Union of the spatial and temporal extents of all OGC API collections.
function extentOf(collections) {
  const boxes = [], starts = [], ends = [];
  let openStart = false, openEnd = false;
  for (const c of collections) {
    const b = c.extent?.spatial?.bbox?.[0];
    if (b?.length === 4) boxes.push(b);
    const t = c.extent?.temporal?.interval?.[0];
    if (t) {
      if (t[0]) starts.push(t[0]); else openStart = true;
      if (t[1]) ends.push(t[1]); else openEnd = true;
    }
  }
  const bbox = boxes.length
    ? [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]
    : NL_BBOX;
  const interval = [
    openStart || !starts.length ? null : starts.sort()[0],
    openEnd || !ends.length ? null : ends.sort().at(-1),
  ];
  return { spatial: { bbox: [bbox] }, temporal: { interval: [interval] } };
}

// Merge the landing page and collections of an OGC API into the index entry.
async function enrich(entry) {
  const root = entry.links[0].href.replace(/\/+$/, "");
  const item = {
    root,
    id: slug(pathOf(root)),
    title: entry.title,
    description: entry.description || entry.title,
    keywords: entry.keywords ?? [],
    ogc: root.includes("/ogc/"),
    collections: [],
    landing: null,
    services: {},
    mapLinks: [],
    pages: [],
    datasetUrl: null,
  };
  if (item.ogc) {
    item.landing = await tryJson(`${root}?f=json`);
    item.keywords = [...new Set([...item.keywords, ...keywordsOf(item.landing)])];
    item.collections = (await tryJson(`${root}/collections?f=json`))?.collections ?? [];
  }
  return item;
}

function assetsOf(item) {
  const { root, landing } = item;
  if (!item.ogc) return { api: { href: root, type: "text/html", title: item.title, roles: ["data"] }, ...item.services };
  const assets = {
    "ogc-api": { href: `${root}?f=json`, type: "application/json", title: "OGC API landing page", roles: ["data"] },
  };
  for (const [rel, key] of [["service-desc", "openapi"], ["conformance", "conformance"]]) {
    const l = linkByRel(landing, rel);
    if (l) assets[key] = { href: l.href, type: l.type ?? "application/json", title: l.title ?? key, roles: ["metadata"] };
  }
  const preview = linkByRel(landing, "preview");
  if (preview) assets.thumbnail = { href: preview.href, type: preview.type ?? "image/png", title: "Thumbnail", roles: ["thumbnail"] };
  for (const c of item.collections) {
    const l = (c.links ?? []).find((x) => x.rel === "items" && x.type === "application/geo+json");
    if (l)
      assets[`items-${slug(c.id)}`] = {
        href: l.href,
        type: "application/geo+json",
        title: `${c.title || c.id} (OGC API Features)`,
        roles: ["data"],
      };
  }
  return { ...assets, ...item.services };
}

const write = async (path, obj) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2), "utf-8");
};

// Run fn over all inputs with limited concurrency.
async function pool(inputs, limit, fn) {
  const results = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < inputs.length) {
        const i = next++;
        results[i] = await fn(inputs[i]);
      }
    }),
  );
  return results;
}

// --- Services (WMS/WFS/WMTS/WCS/ATOM/download) are not in the API index; they are scraped from pdok.nl ---
const BASE = "https://www.pdok.nl";
const SECTIONS = {
  "ogc-webservices": "PDOK (OGC) Webservices",
  "ogc-apis": "PDOK (OGC) API's",
  "atom-downloadservices": "PDOK ATOM Downloadservices",
};
const OGC_SERVICES = new Set(["wms", "wfs", "wmts", "wcs", "tms"]);
const SERVICE_URL = /https?:\/\/(?:service|api)\.pdok\.nl[^"'\s<>)]*/g;
const WEB_MAP_LINKS = "https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json";

const unescapeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&amp;/g, "&");
const clean = (s) => unescapeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
const serviceKey = (url) => new URL(url).pathname.split("/").filter(Boolean).slice(0, 2).join("/");

async function fetchText(url) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "pdok-stac-builder" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

async function parseListing() {
  const page = await fetchText(`${BASE}/datasets`);
  const re = /<article class="card card-dataset.*?<img[^>]*src='([^']*)'.*?class="card-label">(.*?)<\/p>\s*<a href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  return [...page.matchAll(re)].map(([, image, org, url, title]) => ({
    image: unescapeHtml(image),
    provider: clean(org),
    url,
    title: clean(title),
  }));
}

// Returns [key, label, media type] for a PDOK service URL, or null if unknown.
function classify(url) {
  const { hostname, pathname } = new URL(url);
  const parts = pathname.toLowerCase().split("/").filter(Boolean);
  if (hostname === "api.pdok.nl" && parts.includes("ogc")) return ["ogc-api", "OGC API", "application/json"];
  if (hostname === "api.pdok.nl" && parts.includes("download")) return ["download-api", "Download API", "text/html"];
  for (const p of parts) {
    if (OGC_SERVICES.has(p)) return [p, p.toUpperCase(), "application/xml"];
    if (p === "atom") return ["atom", "ATOM download service", "application/atom+xml"];
  }
  return null;
}

// Add a service URL as asset to a target ({services}); skips OGC APIs (covered by the API index) and duplicates.
function addService(target, url) {
  const kind = classify(url);
  if (!kind || kind[0] === "ogc-api") return;
  if (Object.values(target.services).some((a) => a.href.toLowerCase() === url.toLowerCase())) return;
  const [type, label, mediaType] = kind;
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  let key = type, n = 2;
  while (key in target.services) key = `${type}-${n++}`;
  target.services[key] = {
    href: url,
    type: mediaType,
    title: `${label} (${(parts.length > 1 ? parts.slice(1) : parts).join("/")})`,
    roles: ["data"],
  };
}

// First layer name of a WMS (Name) or WMTS (Identifier) capabilities document.
function firstLayer(xml, tag) {
  const ns = "(?:\\w+:)?";
  const re = new RegExp(`<${ns}Layer\\b[^>]*>(?:(?!<\\/?${ns}Layer\\b)[\\s\\S])*?<${ns}${tag}>([^<]+)<`);
  return xml.match(re)?.[1].trim() ?? null;
}

async function mapLink(kind, href, title) {
  const base = href.split("?")[0];
  try {
    if (kind === "wms") {
      const layer = firstLayer(await fetchText(`${base}?service=WMS&request=GetCapabilities&version=1.3.0`), "Name");
      return layer && { rel: "wms", href: base, type: "image/png", title, "wms:layers": [layer], "wms:transparent": true };
    }
    const layer = firstLayer(await fetchText(`${base}?service=WMTS&request=GetCapabilities`), "Identifier");
    return layer && { rel: "wmts", href: base, title, "wmts:layer": layer, "wmts:encoding": "kvp" };
  } catch (e) {
    console.error(`skipped ${kind} link ${base}: ${e.message}`);
    return null;
  }
}

// Read description and service URLs from a dataset page and its sub pages.
async function enrichDataset(d) {
  const page = await fetchText(d.url);
  d.description = clean(page.match(/class="dataset-intro-content">(.*?)<\/p>\s*<\/div>/s)?.[1] ?? "") || d.title;
  d.pages = [];
  d.services = {};
  const urls = new Set();
  for (const [section, title] of Object.entries(SECTIONS)) {
    const m = page.match(new RegExp(`href="\\.\\./\\.\\./\\.\\./${section}/-/article/([^"#]+)"`));
    if (!m) continue;
    const subUrl = `${BASE}/${section}/-/article/${m[1]}`;
    d.pages.push({ href: subUrl, title });
    for (const u of (await fetchText(subUrl)).match(SERVICE_URL) ?? []) urls.add(unescapeHtml(u));
  }
  d.urls = [...urls].sort();
  return d;
}

const index = await fetchJson(INDEX_URL);
console.log(`${index.apis.length} APIs found`);
const items = await pool(index.apis, 16, enrich);

// Merge scraped services into the API collection with the same <provider>/<dataset> path; leftovers become dataset collections.
const datasets = await pool(await parseListing(), 16, enrichDataset);
console.log(`${datasets.length} datasets found`);
const byKey = new Map();
for (const it of items) if (!byKey.has(serviceKey(it.root)) ) byKey.set(serviceKey(it.root), it);
const leftovers = [];
for (const d of datasets) {
  const own = { services: {} };
  for (const url of d.urls) {
    const target = byKey.get(serviceKey(url));
    if (target) {
      addService(target, url);
      target.datasetUrl ??= d.url;
      for (const p of d.pages) if (!target.pages.some((x) => x.href === p.href)) target.pages.push(p);
    } else addService(own, url);
  }
  if (Object.keys(own.services).length) leftovers.push({ ...d, services: own.services });
}
await pool([...items, ...leftovers], 16, async (t) => {
  t.mapLinks = (
    await Promise.all(
      Object.entries(t.services)
        .filter(([key, a]) => /^wm(?:s|ts)(-\d+)?$/.test(key) && /getcapabilities/i.test(a.href))
        .map(([key, a]) => mapLink(key.split("-")[0], a.href, a.title)),
    )
  ).filter(Boolean);
});

await rm(OUT, { recursive: true, force: true });
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const used = new Set();
const links = [];
const all = [
  ...items,
  ...leftovers.map((d) => ({
    root: null,
    id: slug(d.url.replace(/\/+$/, "").split("/").pop() || d.title),
    title: d.title,
    description: d.description,
    keywords: [d.provider],
    provider: d.provider,
    image: d.image,
    ogc: false,
    collections: [],
    landing: null,
    services: d.services,
    mapLinks: d.mapLinks,
    pages: d.pages,
    datasetUrl: d.url,
  })),
];
for (const it of all) {
  let cid = it.id, n = 2;
  while (used.has(cid)) cid = `${it.id}-${n++}`;
  used.add(cid);
  it.id = cid;

  const lic = linkByRel(it.landing, "license");
  const clinks = [
    { rel: "root", href: "../../catalog.json", type: "application/json" },
    { rel: "parent", href: "../../catalog.json", type: "application/json" },
    { rel: "self", href: "./collection.json", type: "application/json" },
  ];
  if (it.root) clinks.push({ rel: "via", href: it.root, type: it.ogc ? "application/json" : "text/html", title: "PDOK API" });
  if (it.datasetUrl) clinks.push({ rel: "alternate", href: it.datasetUrl, type: "text/html", title: "PDOK dataset page" });
  for (const p of it.pages) clinks.push({ rel: "service-doc", href: p.href, type: "text/html", title: p.title });
  clinks.push(...it.mapLinks);
  if (lic) clinks.push({ rel: "license", href: lic.href, type: "text/html", title: lic.title ?? "License" });
  const assets = assetsOf(it);
  if (it.image) assets.thumbnail = { href: it.image, type: "image/jpeg", title: "Thumbnail", roles: ["thumbnail"] };
  const provider = it.provider ?? providerOf(it.root);
  await write(join(OUT, "collections", cid, "collection.json"), {
    type: "Collection",
    stac_version: STAC_VERSION,
    stac_extensions: it.mapLinks.length ? [WEB_MAP_LINKS] : [],
    id: cid,
    title: it.title,
    description: it.description,
    license: "other",
    keywords: ["PDOK", ...it.keywords],
    providers: [
      { name: provider, roles: ["producer"] },
      { name: "PDOK", roles: ["host"], url: "https://www.pdok.nl" },
    ],
    extent: extentOf(it.collections),
    assets,
    links: clinks,
  });
  links.push({ rel: "child", href: `./collections/${cid}/collection.json`, type: "application/json", title: it.title });
}

await write(join(OUT, "catalog.json"), {
  type: "Catalog",
  stac_version: STAC_VERSION,
  id: "pdok-apis",
  title: "PDOK APIs and services",
  description: `STAC catalog of all PDOK APIs listed in ${INDEX_URL}, with WMS/WFS/WMTS/WCS/ATOM services from ${BASE}/datasets (generated on ${now}).`,
  links: [
    { rel: "root", href: "./catalog.json", type: "application/json" },
    { rel: "self", href: "./catalog.json", type: "application/json" },
    { rel: "via", href: INDEX_URL, type: "application/json", title: "PDOK API index" },
    ...links,
  ],
});

const rows = all
  .map((i) => `<li><a href="collections/${i.id}/collection.json">${esc(i.title)}</a> <small>(${esc(i.provider ?? providerOf(i.root))})</small></li>`)
  .join("\n");
await write(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>PDOK STAC catalog</title><h1>PDOK STAC catalog</h1><p><a href="catalog.json">catalog.json</a> (${all.length} collections)</p><ul>${rows}</ul>`,
);
await write(join(OUT, ".nojekyll"), "");
console.log("written to", OUT);
