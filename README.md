# PDOK STAC catalog

Unofficial static [STAC](https://stacspec.org) catalog of all datasets listed on <https://www.pdok.nl/datasets>.

Live catalog: <https://bertt.github.io/pdok-stac/catalog.json>

Browse it online: <https://browser.moregeo.it/external/bertt.github.io/pdok-stac/catalog.json>

<img width="1876" height="922" alt="image" src="https://github.com/user-attachments/assets/f9c4bc33-9f90-4ca9-8978-e646803d2d73" />

## Structure

```
catalog/
  catalog.json                        root catalog
  collections/<id>/collection.json    one collection per PDOK dataset
  index.html                          simple human-readable index
```

All links are relative, so the catalog works under any GitHub Pages sub-path.

Each collection contains the title, description, producer (e.g. Kadaster), thumbnail, a link to the PDOK dataset page and links to its service sub pages (`service-doc`). The services themselves are STAC assets with role `data`, scraped from the dataset's *(OGC) Webservices*, *(OGC) API's* and *ATOM Downloadservices* pages: `wms`, `wfs`, `wmts`, `wcs`, `atom`, `ogc-api` and `download-api` (a numeric suffix such as `wms-2` is added when a dataset has several of the same type).

The WMS and WMTS services are also added as [Web Map Links](https://github.com/stac-extensions/web-map-links) (`rel: wms` / `rel: wmts`, with the first layer of the service from its GetCapabilities as default layer), so clients like STAC Browser can show them on a map. The extension does not cover WFS, ATOM or OGC API, so those are only available as assets. In QGIS, copy the `href` of an asset and add it via the Data Source Manager (WMS/WMTS, WFS or OGC API Features). the spatial extent is a generic bounding box of the Netherlands, the temporal extent is open and the license is `other`, because this information is not available on the overview page.

## Regenerate

Requires Python 3.9+ (standard library only):

```
python build_catalog.py
```

The script scrapes the dataset overview page and every dataset page, then rewrites the `catalog/` folder.

## Host on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes the `catalog/` folder on every push to `main`.
3. The catalog is available at `https://<user>.github.io/<repo>/catalog.json`.

It can be browsed with [STAC Browser](https://radiantearth.github.io/stac-browser/) by passing that URL.
