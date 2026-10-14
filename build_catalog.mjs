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
  if (!item.ogc) return { api: { href: root, type: "text/html", title: item.title, roles: ["data"] } };
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
  return assets;
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

const index = await fetchJson(INDEX_URL);
console.log(`${index.apis.length} APIs found`);
const items = await pool(index.apis, 16, enrich);

await rm(OUT, { recursive: true, force: true });
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const used = new Set();
const links = [];
for (const it of items) {
  let cid = it.id, n = 2;
  while (used.has(cid)) cid = `${it.id}-${n++}`;
  used.add(cid);
  it.id = cid;

  const lic = linkByRel(it.landing, "license");
  const clinks = [
    { rel: "root", href: "../../catalog.json", type: "application/json" },
    { rel: "parent", href: "../../catalog.json", type: "application/json" },
    { rel: "self", href: "./collection.json", type: "application/json" },
    { rel: "via", href: it.root, type: it.ogc ? "application/json" : "text/html", title: "PDOK API" },
  ];
  if (lic) clinks.push({ rel: "license", href: lic.href, type: "text/html", title: lic.title ?? "License" });
  await write(join(OUT, "collections", cid, "collection.json"), {
    type: "Collection",
    stac_version: STAC_VERSION,
    stac_extensions: [],
    id: cid,
    title: it.title,
    description: it.description,
    license: "other",
    keywords: ["PDOK", ...it.keywords],
    providers: [
      { name: providerOf(it.root), roles: ["producer"] },
      { name: "PDOK", roles: ["host"], url: "https://www.pdok.nl" },
    ],
    extent: extentOf(it.collections),
    assets: assetsOf(it),
    links: clinks,
  });
  links.push({ rel: "child", href: `./collections/${cid}/collection.json`, type: "application/json", title: it.title });
}

await write(join(OUT, "catalog.json"), {
  type: "Catalog",
  stac_version: STAC_VERSION,
  id: "pdok-apis",
  title: "PDOK APIs",
  description: `STAC catalog of all APIs listed in ${INDEX_URL} (generated on ${now}).`,
  links: [
    { rel: "root", href: "./catalog.json", type: "application/json" },
    { rel: "self", href: "./catalog.json", type: "application/json" },
    { rel: "via", href: INDEX_URL, type: "application/json", title: "PDOK API index" },
    ...links,
  ],
});

const rows = items
  .map((i) => `<li><a href="collections/${i.id}/collection.json">${esc(i.title)}</a> <small>(${esc(providerOf(i.root))})</small></li>`)
  .join("\n");
await write(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>PDOK STAC catalog</title><h1>PDOK STAC catalog</h1><p><a href="catalog.json">catalog.json</a> (${items.length} collections)</p><ul>${rows}</ul>`,
);
await write(join(OUT, ".nojekyll"), "");
console.log("written to", OUT);
