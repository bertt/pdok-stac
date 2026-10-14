# PDOK STAC catalog

Static [STAC](https://stacspec.org) catalog of the PDOK APIs listed in <https://api.pdok.nl/index.json>, enriched with the WMS/WFS/WMTS/WCS/ATOM services from <https://www.pdok.nl/datasets>.

Live catalog: <https://bertt.github.io/pdok-stac/catalog.json>

Browse it online: <https://browser.moregeo.it/external/bertt.github.io/pdok-stac/catalog.json>

<img width="1876" height="922" alt="image" src="https://github.com/user-attachments/assets/f9c4bc33-9f90-4ca9-8978-e646803d2d73" />

## Structure

```
catalog/
  catalog.json                        root catalog
  collections/<id>/collection.json    one collection per PDOK API or dataset
  collections/<id>/<item>/<item>.json items: one "services" item plus one per OGC API feature collection
  index.html                          simple human-readable index
```

All links are relative, so the catalog works under any GitHub Pages sub-path.

Each collection is one PDOK API from <https://api.pdok.nl/index.json>. Title, description and keywords come from that index; for OGC APIs the landing page and `/collections` add the license link, thumbnail, the real spatial/temporal extent (union of all collections) and assets: `ogc-api` (landing page), `openapi`, `conformance` and one `items-<collection>` asset per feature collection. Other APIs (download APIs, Locatieserver, Location API) get a single `api` asset. The index has no WMS/WFS/WMTS/WCS/ATOM services, so those are the only thing scraped from the pdok.nl dataset pages. They are added as assets (`wms`, `wfs`, `wmts`, `wcs`, `atom`, `download-api`) to the API collection with the same `<provider>/<dataset>` URL path. Datasets without an OGC API get their own collection (thumbnail from the overview page). WMS and WMTS services are also added as [Web Map Links](https://github.com/stac-extensions/web-map-links) (`rel: wms` / `rel: wmts`, first layer from GetCapabilities) so STAC Browser can show them on a map; capabilities that cannot be fetched are skipped with a log line.

Each collection has items so that STAC clients (e.g. GeoLibre) show content: a services item with all service assets, and for OGC APIs one item per feature collection (asset items links to the OGC API Features endpoint, with bbox and thumbnail from /collections).

## Regenerate

Requires Node.js 18+ (no dependencies):

```
node build_catalog.mjs
```

## Known gaps

Two APIs return HTTP 404 on some requests at the time of writing; the generator logs them and continues, so these collections have less metadata:

- `https://api.pdok.nl/kadaster/bag/ogc/v2-demo` (landing page and `/collections`): the BAG demo API. The collection only has the title and description from the index, no keywords, license, thumbnail, `ogc-api` extras or real extent (it falls back to the Netherlands bounding box).
- `https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1/collections`: the BRT Achtergrondkaart is a tiles-only API without feature collections, so it has no `items-*` assets and a Netherlands bounding box.

## Host on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` regenerates the catalog with `node build_catalog.mjs` and publishes it on every push to `main`, manually, and weekly (Mondays 04:00 UTC).
3. The catalog is available at `https://<user>.github.io/<repo>/catalog.json`.

It can be browsed with [STAC Browser](https://radiantearth.github.io/stac-browser/) by passing that URL.
