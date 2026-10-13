"""Scrape https://www.pdok.nl/datasets and write a static STAC catalog to ./catalog.

Output layout (relative links only, so it can be hosted on GitHub Pages):
    catalog/catalog.json
    catalog/collections/<id>/collection.json
    catalog/index.html
"""
import html
import json
import re
import shutil
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

BASE = "https://www.pdok.nl"
# Sub pages of a dataset that list its services
SECTIONS = {
    "ogc-webservices": "PDOK (OGC) Webservices",
    "ogc-apis": "PDOK (OGC) API's",
    "atom-downloadservices": "PDOK ATOM Downloadservices",
}
OGC_SERVICES = {"wms", "wfs", "wmts", "wcs", "tms"}
SERVICE_URL = re.compile(r"https?://(?:service|api)\.pdok\.nl[^\"'\s<>)]*")
OUT = Path(__file__).parent / "catalog"
NL_BBOX = [3.2, 50.75, 7.22, 53.7]
STAC_VERSION = "1.0.0"


def fetch(url):
    """Download a URL as text, retrying up to 3 times."""
    req = Request(url, headers={"User-Agent": "pdok-stac-builder"})
    for _ in range(3):
        try:
            return urlopen(req, timeout=60).read().decode("utf-8")
        except Exception as e:  # retry
            err = e
    raise err


def clean(s):
    """Strip HTML tags, unescape entities and collapse whitespace."""
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def slug(s):
    """Convert a string to a lowercase ASCII identifier."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse_listing():
    """Parse the dataset overview page into a list of dataset cards."""
    page = fetch(f"{BASE}/datasets")
    items = []
    for m in re.finditer(
        r'<article class="card card-dataset.*?<img[^>]*src=\'([^\']*)\'.*?'
        r'class="card-label">(.*?)</p>\s*<a href="([^"]+)"[^>]*>(.*?)</a>',
        page,
        re.S,
    ):
        img, org, url, title = m.groups()
        items.append(
            {"image": html.unescape(img), "provider": clean(org), "url": url, "title": clean(title)}
        )
    return items


def classify(url):
    """Return (key, label, media type) for a PDOK service URL, or None if unknown."""
    parsed = urlparse(url)
    parts = [p for p in parsed.path.lower().split("/") if p]
    if parsed.netloc == "api.pdok.nl" and "ogc" in parts:
        return "ogc-api", "OGC API", "application/json"
    if parsed.netloc == "api.pdok.nl" and "download" in parts:
        return "download-api", "Download API", "text/html"
    for part in parts:
        if part in OGC_SERVICES:
            return part, part.upper(), "application/xml"
        if part == "atom":
            return "atom", "ATOM download service", "application/atom+xml"
    return None


def service_assets(urls):
    """Turn a collection of service URLs into STAC assets keyed by service type."""
    assets, seen = {}, set()
    for url in sorted(urls):
        kind = classify(url)
        norm = url.lower()
        if not kind or norm in seen:
            continue
        seen.add(norm)
        key, label, media_type = kind
        parts = [p for p in urlparse(url).path.split("/") if p]
        name = "/".join(parts[1:]) if len(parts) > 1 else "/".join(parts)
        base, n = key, 2
        while key in assets:
            key, n = f"{base}-{n}", n + 1
        assets[key] = {
            "href": url,
            "type": media_type,
            "title": f"{label} ({name})",
            "roles": ["data"],
        }
    return assets


def enrich(item):
    """Add description, logo and service URLs from the dataset page and its sub pages."""
    page = fetch(item["url"])
    d = re.search(r'class="dataset-intro-content">(.*?)</p>\s*</div>', page, re.S)
    item["description"] = clean(d.group(1)) if d else item["title"]
    logo = re.search(r'class="img-fluid img-rounded" src="([^"]+)"', page)
    item["logo"] = html.unescape(logo.group(1)) if logo else None

    item["pages"], urls = [], set()
    for section, title in SECTIONS.items():
        m = re.search(r'href="\.\./\.\./\.\./%s/-/article/([^"#]+)"' % section, page)
        if not m:
            continue
        sub_url = f"{BASE}/{section}/-/article/{m.group(1)}"
        item["pages"].append((sub_url, title))
        urls.update(html.unescape(u) for u in SERVICE_URL.findall(fetch(sub_url)))
    item["services"] = service_assets(urls)
    return item


def write(path, obj):
    """Write an object as pretty-printed JSON, creating parent folders."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    """Build the catalog: one STAC Collection per PDOK dataset."""
    items = parse_listing()
    print(f"{len(items)} datasets found")
    with ThreadPoolExecutor(8) as ex:
        items = list(ex.map(enrich, items))

    if OUT.exists():
        shutil.rmtree(OUT)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    used, links = set(), []
    for it in items:
        cid = it["url"].rstrip("/").rsplit("/", 1)[-1] or slug(it["title"])
        cid = slug(cid)
        base, n = cid, 2
        while cid in used:
            cid, n = f"{base}-{n}", n + 1
        used.add(cid)

        clinks = [
            {"rel": "root", "href": "../../catalog.json", "type": "application/json"},
            {"rel": "parent", "href": "../../catalog.json", "type": "application/json"},
            {"rel": "self", "href": f"./collection.json", "type": "application/json"},
            {"rel": "alternate", "href": it["url"], "type": "text/html", "title": "PDOK dataset page"},
        ]
        for sub_url, sub_title in it["pages"]:
            clinks.append({"rel": "service-doc", "href": sub_url, "type": "text/html", "title": sub_title})
        coll = {
            "type": "Collection",
            "stac_version": STAC_VERSION,
            "id": cid,
            "title": it["title"],
            "description": it["description"],
            "license": "other",
            "keywords": ["PDOK", it["provider"]],
            "providers": [
                {"name": it["provider"], "roles": ["producer"]},
                {"name": "PDOK", "roles": ["host"], "url": BASE},
            ],
            "extent": {
                "spatial": {"bbox": [NL_BBOX]},
                "temporal": {"interval": [[None, None]]},
            },
            "assets": {
                "thumbnail": {
                    "href": it["image"],
                    "type": "image/jpeg",
                    "title": "Thumbnail",
                    "roles": ["thumbnail"],
                },
                **it["services"],
            },
            "links": clinks,
        }
        write(OUT / "collections" / cid / "collection.json", coll)
        links.append(
            {"rel": "child", "href": f"./collections/{cid}/collection.json", "type": "application/json", "title": it["title"]}
        )
        it["id"] = cid

    catalog = {
        "type": "Catalog",
        "stac_version": STAC_VERSION,
        "id": "pdok-datasets",
        "title": "PDOK datasets",
        "description": "Unofficial STAC catalog of all datasets listed on https://www.pdok.nl/datasets (generated on "
        + now
        + ").",
        "links": [
            {"rel": "root", "href": "./catalog.json", "type": "application/json"},
            {"rel": "self", "href": "./catalog.json", "type": "application/json"},
            {"rel": "alternate", "href": f"{BASE}/datasets", "type": "text/html", "title": "PDOK datasets"},
        ]
        + links,
    }
    write(OUT / "catalog.json", catalog)

    rows = "\n".join(
        f'<li><a href="collections/{i["id"]}/collection.json">{html.escape(i["title"])}</a> '
        f'<small>({html.escape(i["provider"])})</small></li>'
        for i in items
    )
    (OUT / "index.html").write_text(
        f'<!doctype html><meta charset="utf-8"><title>PDOK STAC catalog</title>'
        f"<h1>PDOK STAC catalog</h1><p><a href=\"catalog.json\">catalog.json</a> ({len(items)} collections)</p>"
        f"<ul>{rows}</ul>",
        encoding="utf-8",
    )
    (OUT / ".nojekyll").write_text("")
    print("written to", OUT)


if __name__ == "__main__":
    sys.exit(main())
