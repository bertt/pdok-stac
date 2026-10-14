# PDOK STAC catalog

Static [STAC](https://stacspec.org) catalog of the PDOK APIs listed in <https://api.pdok.nl/index.json>, enriched with the WMS/WFS/WMTS/WCS/ATOM services from <https://www.pdok.nl/datasets>.

Live catalog: <https://bertt.github.io/pdok-stac/catalog.json>

Browse it online: <https://browser.moregeo.it/external/bertt.github.io/pdok-stac/catalog.json>

<img width="1876" height="922" alt="image" src="https://github.com/user-attachments/assets/f9c4bc33-9f90-4ca9-8978-e646803d2d73" />

## Structure

```
catalog/
  catalog.json                        root catalog
  <provider>/catalog.json             sub catalog per provider (Kadaster, CBS, RVO, ...)
  collections/<id>/collection.json    one collection per PDOK API or dataset
  collections/<id>/<item>/<item>.json items: one "services" item plus one per OGC API feature collection
  index.html                          simple human-readable index
```

All links are relative, so the catalog works under any GitHub Pages sub-path.

## Main groups

The root catalog <https://bertt.github.io/pdok-stac/catalog.json> has one sub catalog per provider (215 collections in total, one per PDOK API or dataset):

| Group | Collections |
|---|---|
| [Kadaster](https://bertt.github.io/pdok-stac/kadaster/catalog.json) | 52 |
| [Rijksdienst voor Ondernemend Nederland](https://bertt.github.io/pdok-stac/rijksdienst-voor-ondernemend-nederland/catalog.json) | 34 |
| [Ministerie van Binnenlandse Zaken en Koninkrijksrelaties](https://bertt.github.io/pdok-stac/ministerie-van-binnenlandse-zaken-en-koninkrijksrelaties/catalog.json) | 33 |
| [Centraal Bureau voor de Statistiek](https://bertt.github.io/pdok-stac/centraal-bureau-voor-de-statistiek/catalog.json) | 26 |
| [Rijkswaterstaat](https://bertt.github.io/pdok-stac/rijkswaterstaat/catalog.json) | 24 |
| [Provincies](https://bertt.github.io/pdok-stac/provincies/catalog.json) | 10 |
| [Het Waterschapshuis](https://bertt.github.io/pdok-stac/het-waterschapshuis/catalog.json) | 10 |
| [Informatiehuis Water](https://bertt.github.io/pdok-stac/informatiehuis-water/catalog.json) | 7 |
| [Ministerie van Infrastructuur en Waterstaat](https://bertt.github.io/pdok-stac/ministerie-van-infrastructuur-en-waterstaat/catalog.json) | 4 |
| [Stichting Landelijk Fietsplatform](https://bertt.github.io/pdok-stac/stichting-landelijk-fietsplatform/catalog.json) | 2 |
| [RIONED](https://bertt.github.io/pdok-stac/rioned/catalog.json) | 2 |
| [Stichting Wandelnet](https://bertt.github.io/pdok-stac/stichting-wandelnet/catalog.json) | 2 |
| [Rijksdienst voor het Cultureel Erfgoed](https://bertt.github.io/pdok-stac/rijksdienst-voor-het-cultureel-erfgoed/catalog.json) | 2 |
| [Publieke Dienstverlening Op de Kaart](https://bertt.github.io/pdok-stac/publieke-dienstverlening-op-de-kaart/catalog.json) | 2 |
| [ProRail](https://bertt.github.io/pdok-stac/prorail/catalog.json) | 1 |
| [Kamer van Koophandel](https://bertt.github.io/pdok-stac/kamer-van-koophandel/catalog.json) | 1 |
| [TNO](https://bertt.github.io/pdok-stac/tno/catalog.json) | 1 |
| [Wageningen University & Research](https://bertt.github.io/pdok-stac/wageningen-university-research/catalog.json) | 1 |
| [Defensie](https://bertt.github.io/pdok-stac/defensie/catalog.json) | 1 |

The counts are a snapshot; the catalog is rebuilt weekly.

Each collection is one PDOK API from <https://api.pdok.nl/index.json>. Title, description and keywords come from that index; for OGC APIs the landing page and `/collections` add the license link, thumbnail, the real spatial/temporal extent (union of all collections) and assets: `ogc-api` (landing page), `openapi`, `conformance` and one `items-<collection>` asset per feature collection. Other APIs (download APIs, Locatieserver, Location API) get a single `api` asset. The index has no WMS/WFS/WMTS/WCS/ATOM services, so those are the only thing scraped from the pdok.nl dataset pages. They are added as assets (`wms`, `wfs`, `wmts`, `wcs`, `atom`, `download-api`) to the API collection with the same `<provider>/<dataset>` URL path. Datasets without an OGC API get their own collection (thumbnail from the overview page). WMS and WMTS services are also added as [Web Map Links](https://github.com/stac-extensions/web-map-links) (`rel: wms` / `rel: wmts`, first layer from GetCapabilities) so STAC Browser can show them on a map; capabilities that cannot be fetched are skipped with a log line.

Each collection has items so that STAC clients (e.g. GeoLibre) show content: a services item with all service assets, and for OGC APIs one item per feature collection (asset items links to the OGC API Features endpoint, with bbox and thumbnail from /collections).

Collections get the license from the API landing page as SPDX id (`CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-ND-4.0`; `other` for Public Domain Mark, which has no SPDX id, with the license link always included), `updated` (newest update of its feature collections), an `alternate` link to STAC Browser and a `describedby` link to the API landing page.

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
