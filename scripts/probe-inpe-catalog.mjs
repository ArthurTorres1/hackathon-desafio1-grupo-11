import { readFile } from 'node:fs/promises';

const base = 'https://data.inpe.br/bdc/stac/v1';
const queriedAt = new Date().toISOString();
const fixture = JSON.parse(await readFile('data/public_samples/demo-plot.geojson', 'utf8'));
const request = {
  intersects: fixture.geometry,
  collections: ['S2-16D-2'],
  datetime: '2026-10-01T00:00:00Z/2026-10-31T23:59:59Z',
  limit: 1,
};

const response = await fetch(`${base}/search`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/geo+json' },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(30_000),
});
console.log(`POST /search HTTP ${response.status}`);
if (!response.ok) throw new Error(`STAC search failed with HTTP ${response.status}`);

const result = await response.json();
const item = result.features?.[0];
if (!item) {
  console.log(JSON.stringify({ queried_at: queriedAt, request, matchedItems: 0 }, null, 2));
  process.exit(0);
}

const collectionResponse = await fetch(`${base}/collections/${encodeURIComponent(item.collection)}`, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(30_000),
});
if (!collectionResponse.ok) throw new Error(`Collection lookup failed with HTTP ${collectionResponse.status}`);
const collection = await collectionResponse.json();

const output = {
  queried_at: queriedAt,
  request,
  matchedItemsInPage: result.features.length,
  item: {
    collection: item.collection,
    id: item.id,
    datetime: item.properties?.datetime ?? null,
    start_datetime: item.properties?.start_datetime ?? null,
    end_datetime: item.properties?.end_datetime ?? null,
    cloud_cover: item.properties?.['eo:cloud_cover'] ?? null,
    license: item.properties?.license ?? null,
    self: item.links?.find((link) => link.rel === 'self')?.href ?? null,
    rgbAssets: Object.fromEntries(['B04', 'B03', 'B02'].map((key) => [key, {
      href: item.assets?.[key]?.href ?? null,
      type: item.assets?.[key]?.type ?? null,
      roles: item.assets?.[key]?.roles ?? null,
    }])),
  },
  collection: {
    id: collection.id,
    title: collection.title,
    license: collection.license ?? null,
    temporalExtent: collection.extent?.temporal?.interval ?? null,
    providers: collection.providers ?? [],
  },
};
console.log(JSON.stringify(output, null, 2));
