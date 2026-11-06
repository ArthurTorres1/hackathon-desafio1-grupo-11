import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(join(apiRoot, 'package.json'));
const packageVersion = async (name: string) => {
  const modulePath = requireFromApi.resolve(name);
  const packagePath = join(dirname(dirname(modulePath)), 'package.json');
  return (JSON.parse(await readFile(packagePath, 'utf8')) as { version: string }).version;
};
const { PNG } = requireFromApi('pngjs') as {
  PNG: { sync: { write(image: { width: number; height: number; data: Buffer }): Buffer } };
};

const itemId = 'S2-16D_V2_016009_20261016';
const assetBase = `https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/${itemId}`;
const bands = [
  { key: 'B04', channel: 0, commonName: 'red' },
  { key: 'B03', channel: 1, commonName: 'green' },
  { key: 'B02', channel: 2, commonName: 'blue' },
] as const;
const bboxWgs84: [number, number, number, number] = [-60, -3, -59.99, -2.99];
const outWidth = 96;
const outputMaxSide = 1024;
const maxBytes = 32 * 1024 * 1024;
let bytesRead = 0;
const nativeFetch = globalThis.fetch;
const startedAt = performance.now();
const startingRss = process.memoryUsage().rss;
const probeTimeoutMs = 20_000;
const probeDeadline = AbortSignal.timeout(probeTimeoutMs);

const bdcCrs = '+proj=aea +lat_1=-2 +lat_2=-22 +lat_0=-12 +lon_0=-54 +x_0=5000000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs';
const sourceToWgs84 = proj4(bdcCrs, 'EPSG:4326');
const wgs84ToSource = proj4('EPSG:4326', bdcCrs);
const wgs84ToMercator = proj4('EPSG:4326', 'EPSG:3857');

function countedRangeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = requestSignal ? AbortSignal.any([requestSignal, probeDeadline]) : probeDeadline;
  return nativeFetch(input, { ...init, signal }).then((response) => {
    const headers = input instanceof Request ? new Headers(input.headers) : new Headers();
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const rangeHeader = headers.get('range');
    if (!rangeHeader?.startsWith('bytes=') || rangeHeader.includes(',')) {
      void response.body?.cancel();
      throw new Error('Probe requires one explicit byte range per request');
    }
    if (response.status !== 206) {
      void response.body?.cancel();
      throw new Error(`Range request returned HTTP ${response.status}, expected 206`);
    }
    const contentRange = response.headers.get('content-range') ?? '';
    const requested = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    const returned = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange);
    if (!requested || !returned || requested[1] !== returned[1] || requested[2] !== returned[2]) {
      void response.body?.cancel();
      throw new Error(`Invalid Content-Range for ${rangeHeader}: ${contentRange || '(missing)'}`);
    }
    const declaredLength = Number(returned[2]) - Number(returned[1]) + 1;
    const contentLength = Number(response.headers.get('content-length'));
    const remaining = maxBytes - bytesRead;
    if (declaredLength > remaining || (Number.isFinite(contentLength) && contentLength > remaining)) {
      void response.body?.cancel();
      throw new Error(`Range byte budget would be exceeded: ${bytesRead} + ${declaredLength} > ${maxBytes}`);
    }
    if (!response.body) throw new Error('Range response has no body');

    const reader = response.body.getReader();
    const boundedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        if (bytesRead + result.value.byteLength > maxBytes) {
          await reader.cancel();
          controller.error(new Error(`Range byte budget exceeded ${maxBytes} bytes`));
          return;
        }
        bytesRead += result.value.byteLength;
        controller.enqueue(result.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(boundedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
}

function lonLatToSourcePixel(lon: number, lat: number, origin: [number, number], resolution: [number, number]) {
  const [x, y] = wgs84ToSource.forward([lon, lat]);
  return [(x - origin[0]) / resolution[0], (y - origin[1]) / resolution[1]] as const;
}

function mercatorForwardAnalytic(lon: number, lat: number): [number, number] {
  const radius = 6378137;
  const longitudeRadians = lon * Math.PI / 180;
  const latitudeRadians = lat * Math.PI / 180;
  return [radius * longitudeRadians, radius * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2))];
}

function verifyControlPoints(
  origin: [number, number],
  resolution: [number, number],
  sourceWidth: number,
  sourceHeight: number,
  outputBounds: [number, number, number, number],
  width: number,
  height: number,
) {
  const controlPoints = [
    { pixel: [0, 0], reference: [-60.19141463591476, -2.959791516989484] },
    { pixel: [0, sourceHeight], reference: [-60.21256392965003, -3.910790451705581] },
    { pixel: [sourceWidth, sourceHeight], reference: [-59.257030293813216, -3.9302648349457026] },
  ] as const;
  const [minX, minY, maxX, maxY] = outputBounds;
  const pixelSizeX = (maxX - minX) / width;
  const pixelSizeY = (maxY - minY) / height;
  const errors = controlPoints.map(({ pixel: [pixelX, pixelY], reference }) => {
    const sourceX = origin[0] + pixelX * resolution[0];
    const sourceY = origin[1] + pixelY * resolution[1];
    const actualWgs84 = sourceToWgs84.forward([sourceX, sourceY]);
    const actualMercator = mercatorForwardAnalytic(actualWgs84[0], actualWgs84[1]);
    const referenceMercator = mercatorForwardAnalytic(reference[0], reference[1]);
    return Math.hypot(
      (actualMercator[0] - referenceMercator[0]) / pixelSizeX,
      (actualMercator[1] - referenceMercator[1]) / pixelSizeY,
    );
  });
  const maxErrorPx = Math.max(...errors);
  if (maxErrorPx > 1) throw new Error(`Mercator control-point error ${maxErrorPx} pixels exceeds 1`);
  return {
    reference: 'Three outer-corner coordinates from the STAC item footprint, independent of the GeoTIFF tags read by this probe.',
    points: controlPoints.map(({ pixel, reference }, index) => ({ sourcePixel: pixel, referenceLonLat: reference, errorPx: errors[index] })),
    maxErrorPx,
  };
}

globalThis.fetch = countedRangeFetch;

try {
  const projectedCorners = [
    wgs84ToSource.forward([bboxWgs84[0], bboxWgs84[1]]),
    wgs84ToSource.forward([bboxWgs84[0], bboxWgs84[3]]),
    wgs84ToSource.forward([bboxWgs84[2], bboxWgs84[1]]),
    wgs84ToSource.forward([bboxWgs84[2], bboxWgs84[3]]),
  ];
  const [minSourceX, maxSourceX] = [Math.min(...projectedCorners.map(([x]) => x)), Math.max(...projectedCorners.map(([x]) => x))];
  const [minSourceY, maxSourceY] = [Math.min(...projectedCorners.map(([, y]) => y)), Math.max(...projectedCorners.map(([, y]) => y))];

  const bandRasters: Float32Array[] = [];
  let sourceOrigin: [number, number] | undefined;
  let sourceResolution: [number, number] | undefined;
  let sourceWindow: [number, number, number, number] | undefined;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let bandMetadata: unknown[] = [];

  for (const band of bands) {
    const tiff = await fromUrl(`${assetBase}_${band.key}.tif`, { allowFullFile: false });
    const image = await tiff.getImage();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const window: [number, number, number, number] = [
      Math.max(0, Math.floor((minSourceX - origin[0]) / resolution[0]) - 1),
      Math.max(0, Math.floor((maxSourceY - origin[1]) / resolution[1]) - 1),
      Math.min(image.getWidth(), Math.ceil((maxSourceX - origin[0]) / resolution[0]) + 1),
      Math.min(image.getHeight(), Math.ceil((minSourceY - origin[1]) / resolution[1]) + 1),
    ];
    if (!sourceOrigin) {
      sourceOrigin = [origin[0], origin[1]];
      sourceResolution = [resolution[0], resolution[1]];
      sourceWindow = window;
      sourceWidth = image.getWidth();
      sourceHeight = image.getHeight();
    } else if (sourceWindow?.some((value, index) => value !== window[index])) {
      throw new Error('RGB band COG windows do not align');
    }
    const raster = await image.readRasters({ window, samples: [0], interleave: true });
    bandRasters.push(raster as Float32Array);
    bandMetadata.push({
      band: band.key,
      stac: { dataType: 'uint16', nodata: 0, scale: 0.0001, scaleAdd: null, min: 0, max: 10000, resolutionMeters: 10 },
      geoKeys: await image.getGeoKeys(),
      modelPixelScale: image.fileDirectory.getValue('ModelPixelScale'),
      modelTiepoint: image.fileDirectory.getValue('ModelTiepoint'),
      nodata: image.getGDALNoData(),
      sampleFormatTag: image.fileDirectory.getValue('SampleFormat'),
      bitDepth: image.fileDirectory.getValue('BitsPerSample'),
      range: [Math.min(...Array.from(raster as Float32Array)), Math.max(...Array.from(raster as Float32Array))],
      window,
    });
  }

  if (!sourceOrigin || !sourceResolution || !sourceWindow) throw new Error('No band data was read');

  const mercatorCorners = [
    wgs84ToMercator.forward([bboxWgs84[0], bboxWgs84[1]]),
    wgs84ToMercator.forward([bboxWgs84[0], bboxWgs84[3]]),
    wgs84ToMercator.forward([bboxWgs84[2], bboxWgs84[1]]),
    wgs84ToMercator.forward([bboxWgs84[2], bboxWgs84[3]]),
  ];
  const minX = Math.min(...mercatorCorners.map(([x]) => x));
  const maxX = Math.max(...mercatorCorners.map(([x]) => x));
  const minY = Math.min(...mercatorCorners.map(([, y]) => y));
  const maxY = Math.max(...mercatorCorners.map(([, y]) => y));
  const outputAspect = (maxX - minX) / (maxY - minY);
  const outHeight = Math.max(1, Math.min(outputMaxSide, Math.round(outWidth / outputAspect)));
  const outPixels = outWidth * outHeight;
  const rgb = Buffer.alloc(outPixels * 4);
  const [windowX0, windowY0, windowX1] = sourceWindow;
  const windowWidth = windowX1 - windowX0;

  for (let row = 0; row < outHeight; row += 1) {
    for (let col = 0; col < outWidth; col += 1) {
      const mercatorX = minX + (col + 0.5) * (maxX - minX) / outWidth;
      const mercatorY = maxY - (row + 0.5) * (maxY - minY) / outHeight;
      const lon = mercatorX / 6378137 * 180 / Math.PI;
      const lat = (2 * Math.atan(Math.exp(mercatorY / 6378137)) - Math.PI / 2) * 180 / Math.PI;
      const [pixelX, pixelY] = lonLatToSourcePixel(lon, lat, sourceOrigin, sourceResolution);
      const localX = Math.floor(pixelX) - windowX0;
      const localY = Math.floor(pixelY) - windowY0;
      const pixelIndex = localY * windowWidth + localX;
      const outputIndex = (row * outWidth + col) * 4;
      const values = bandRasters.map((raster) => raster[pixelIndex]);
      const insideSource = localX >= 0 && localX < windowWidth && localY >= 0 && localY < sourceWindow[3] - sourceWindow[1] && Number.isFinite(values[0]);
      if (!insideSource || values.some((value) => value === 0 || !Number.isFinite(value))) {
        rgb[outputIndex + 3] = 0;
        continue;
      }
      rgb[outputIndex] = Math.max(0, Math.min(255, Math.round((values[0] ?? 0) * 255 / 10000)));
      rgb[outputIndex + 1] = Math.max(0, Math.min(255, Math.round((values[1] ?? 0) * 255 / 10000)));
      rgb[outputIndex + 2] = Math.max(0, Math.min(255, Math.round((values[2] ?? 0) * 255 / 10000)));
      rgb[outputIndex + 3] = 255;
    }
  }

  const png = PNG.sync.write({ width: outWidth, height: outHeight, data: rgb });
  const controls = verifyControlPoints(sourceOrigin, sourceResolution, sourceWidth, sourceHeight, [minX, minY, maxX, maxY], outWidth, outHeight);
  const boundsWgs84 = [
    wgs84ToMercator.inverse([minX, minY]),
    wgs84ToMercator.inverse([maxX, maxY]),
  ];
  const alphaPixels = Array.from({ length: outPixels }, (_, index) => rgb[index * 4 + 3]).filter((alpha) => alpha === 255).length;
  const report = {
    result: 'rendered',
    itemId,
    bands: bands.map(({ key, commonName }) => ({ key, commonName })),
    bboxWgs84,
    projectedBoundsEpsg3857: [minX, minY, maxX, maxY],
    renderBoundsWgs84: boundsWgs84,
    output: { width: outWidth, height: outHeight, pngBytes: png.byteLength, rgbaPixels: outPixels, coveredPixels: alphaPixels },
    source: { origin: sourceOrigin, resolution: sourceResolution, width: sourceWidth, height: sourceHeight, crs: 'BDC custom Albers Equal-Area Conic (official BDC FAQ PROJ string)' },
    bandMetadata,
    controlPoints: controls,
    bytesRead,
    maxBytes,
    sampleFormatMismatch: 'TIFF SampleFormat=2 (signed integer) while STAC eo:bands declares uint16; sampled raw values fell within STAC range 0..10000. Rendering applies the STAC scale 0.0001 as a linear 0..1 reflectance to 8-bit RGB conversion.',
    imageLicense: 'Collection license is proprietary; item license is null. Do not redistribute the generated image.',
    runtime: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      libraries: {
        geotiff: await packageVersion('geotiff'),
        proj4: await packageVersion('proj4'),
        pngjs: await packageVersion('pngjs'),
      },
      elapsedMs: Math.round(performance.now() - startedAt),
      timeoutMs: probeTimeoutMs,
      rssStartBytes: startingRss,
      rssEndBytes: process.memoryUsage().rss,
      rssDeltaBytes: process.memoryUsage().rss - startingRss,
    },
    generatedArtifacts: { png: 'data/private/inpe-render-probe.png', report: 'data/private/inpe-render-probe.json' },
  };
  const privateDir = join(repoRoot, 'data', 'private');
  await mkdir(privateDir, { recursive: true });
  await writeFile(join(privateDir, 'inpe-render-probe.png'), png);
  await writeFile(join(privateDir, 'inpe-render-probe.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify(report));
} finally {
  globalThis.fetch = nativeFetch;
}
