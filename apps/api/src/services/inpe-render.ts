import { BaseClient, BaseResponse, fromCustomClient } from 'geotiff';
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { safeInpeRange, assertInpeUrl, INPE_MAX_ASSET_BYTES, InpeTransportError, type InpeByteBudget } from './inpe-transport.js';

export const BDC_CRS = '+proj=aea +lat_1=-2 +lat_2=-22 +lat_0=-12 +lon_0=-54 +x_0=5000000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs';
export type InpeRenderInput = { assets: { B04: string; B03: string; B02: string }; bbox: [number, number, number, number] };
export type InpeRenderOptions = { signal?: AbortSignal; maxSide?: number; range?: typeof safeInpeRange };
const fail = (message: string): never => { throw new InpeTransportError('SEM_VISUALIZACAO', message, 422); };

/** A narrow crop can touch many large tiles: bound the decoded blocks, not only the crop. */
export function assertInpeDecodeBudget(window: number[], tileWidth: number, tileHeight: number, bytesPerPixel: number) {
  if (![tileWidth,tileHeight,bytesPerPixel].every(value=>Number.isSafeInteger(value)&&value>0) || bytesPerPixel>4) return fail('Bloco TIFF inválido.');
  const tilesX=Math.ceil(window[2]!/tileWidth)-Math.floor(window[0]!/tileWidth);
  const tilesY=Math.ceil(window[3]!/tileHeight)-Math.floor(window[1]!/tileHeight);
  const decodedPixels=tilesX*tilesY*tileWidth*tileHeight;
  if (!Number.isSafeInteger(decodedPixels) || decodedPixels>16_777_216) return fail('Conjunto de blocos TIFF excede o limite de memória decodificada.');
}

/** Each TIFF owns its client. No global fetch replacement and no full-file fallback. */
class RangeClient extends BaseClient {
  constructor(url: string, private readonly budget: InpeByteBudget, private readonly deadline: AbortSignal, private readonly read: typeof safeInpeRange) { super(url); }
  override async request(options: RequestInit = {}) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('range') ?? '');
    if (!match) return fail('A leitura exige uma janela HTTP Range única.');
    const signal = AbortSignal.any([this.deadline, ...(options.signal ? [options.signal] : [])]);
    const response = await this.read(this.url, [Number(match[1]), Number(match[2])], this.budget, signal);
    if (response.status !== 206) return fail('O asset não suporta HTTP Range.');
    return new class extends BaseResponse {
      override get status() { return response.status; }
      override getHeader(name: string) { return response.headers[name.toLowerCase()]; }
      override async getData() { return Uint8Array.from(response.body).buffer; }
    }();
  }
}

export async function renderInpeScene(input: InpeRenderInput, options: InpeRenderOptions = {}) {
  const [west,south,east,north] = input.bbox;
  if (!input.bbox.every(Number.isFinite) || west >= east || south >= north || west < -180 || east > 180 || south < -85 || north > 85) return fail('Bounds inválidos para renderização.');
  const side = options.maxSide ?? 1024;
  if (!Number.isInteger(side) || side < 1 || side > 1024) return fail('A imagem deve ter até 1024 pixels por lado.');
  Object.values(input.assets).forEach(url => assertInpeUrl(url, 'asset'));
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]);
  const deadline = Date.now()+20_000;
  const checkDeadline = () => { signal.throwIfAborted(); if (Date.now()>deadline) throw new InpeTransportError('INPE_UNAVAILABLE','Prazo de renderização excedido.'); };
  const budget = { bytes_read: 0, max_bytes: INPE_MAX_ASSET_BYTES, retries_remaining: 1 };
  const sourceProjection = proj4('EPSG:4326', BDC_CRS);
  const mercator = proj4('EPSG:4326', 'EPSG:3857');
  const [minX,minY] = mercator.forward([west,south]) as [number,number];
  const [maxX,maxY] = mercator.forward([east,north]) as [number,number];
  if (![minX,minY,maxX,maxY].every(Number.isFinite) || maxX<=minX || maxY<=minY) return fail('Bounds sem resolução espacial válida.');
  const aspect = (maxX-minX)/(maxY-minY);
  const width = Math.max(1, Math.round(aspect >= 1 ? side : side*aspect));
  const height = Math.max(1, Math.round(aspect >= 1 ? side/aspect : side));
  // Densify bbox edges: Albers maps straight geographic edges to curves.
  const points: number[][] = [];
  for (let i=0;i<=32;i++) {
    const t=i/32;
    points.push(sourceProjection.forward([west+(east-west)*t,south]),sourceProjection.forward([west+(east-west)*t,north]),sourceProjection.forward([west,south+(north-south)*t]),sourceProjection.forward([east,south+(north-south)*t]));
  }
  const sx0=Math.min(...points.map(p=>p[0]!)), sx1=Math.max(...points.map(p=>p[0]!));
  const sy0=Math.min(...points.map(p=>p[1]!)), sy1=Math.max(...points.map(p=>p[1]!));
  const bands: { raster: ArrayLike<number>; origin: number[]; resolution: number[]; window: number[]; nodata: number | null }[] = [];
  for (const key of ['B04','B03','B02'] as const) {
    checkDeadline();
    const tiff = await fromCustomClient(new RangeClient(input.assets[key],budget,signal,options.range ?? safeInpeRange),{allowFullFile:false},signal);
    const image = await tiff.getImage();
    const origin=image.getOrigin(), resolution=image.getResolution();
    const keys=image.getGeoKeys();
    if (image.getTileWidth()*image.getTileHeight()>4_194_304 || image.getBytesPerPixel()>4) return fail('Bloco TIFF excede o limite de memória decodificada.');
    const requiredKeys: Record<string,number> = {ProjCoordTransGeoKey:11,ProjLinearUnitsGeoKey:9001,ProjStdParallel1GeoKey:-2,ProjStdParallel2GeoKey:-22,ProjNatOriginLongGeoKey:-54,ProjNatOriginLatGeoKey:-12,ProjFalseEastingGeoKey:5000000,ProjFalseNorthingGeoKey:10000000};
    if (![...origin,...resolution].every(Number.isFinite) || !Number.isSafeInteger(image.getWidth()) || !Number.isSafeInteger(image.getHeight()) || image.fileDirectory.getValue('ModelTransformation') || !(resolution[0]!>0 && resolution[1]!<0) || Object.entries(requiredKeys).some(([key,value]) => (keys as Record<string,unknown>)?.[key] !== value) || image.getSamplesPerPixel() !== 1) return fail('CRS, rotação ou bandas incompatíveis com a configuração BDC aprovada.');
    const window=[Math.max(0,Math.floor((sx0-origin[0]!)/resolution[0]!)-1),Math.max(0,Math.floor((sy1-origin[1]!)/resolution[1]!)-1),Math.min(image.getWidth(),Math.ceil((sx1-origin[0]!)/resolution[0]!)+1),Math.min(image.getHeight(),Math.ceil((sy0-origin[1]!)/resolution[1]!)+1)];
    if (window[2]!<=window[0]! || window[3]!<=window[1]!) return fail('Cena sem cobertura do recorte.');
    // Bound decoded memory as well as compressed HTTP bytes (three <=16MiB bands).
    if ((window[2]!-window[0]!)*(window[3]!-window[1]!)>4_194_304) return fail('Janela decodificada excede o limite de pixels.');
    assertInpeDecodeBudget(window,image.getTileWidth(),image.getTileHeight(),image.getBytesPerPixel());
    const raster=await image.readRasters({window,samples:[0],interleave:true,signal});
    bands.push({raster:raster as ArrayLike<number>,origin,resolution,window,nodata:image.getGDALNoData()});
  }
  const rgba=Buffer.alloc(width*height*4);
  for (let row=0;row<height;row++) {
    checkDeadline();
    for (let col=0;col<width;col++) {
      const [lon,lat]=mercator.inverse([minX+(col+.5)*(maxX-minX)/width,maxY-(row+.5)*(maxY-minY)/height]);
      const [x,y]=sourceProjection.forward([lon!,lat!]);
      const values=bands.map(b=>{
        const px=Math.floor((x!-b.origin[0]!)/b.resolution[0]!)-b.window[0]!;
        const py=Math.floor((y!-b.origin[1]!)/b.resolution[1]!)-b.window[1]!;
        const w=b.window[2]!-b.window[0]!;
        if(px<0||py<0||px>=w||py>=b.window[3]!-b.window[1]!) return NaN;
        const value=b.raster[py*w+px];
        return value===b.nodata || value===0 ? NaN : value!;
      });
      const offset=(row*width+col)*4;
      if(values.every(Number.isFinite)) {
        for(let channel=0;channel<3;channel++) rgba[offset+channel]=Math.max(0,Math.min(255,Math.round(values[channel]!*0.0001*255)));
        rgba[offset+3]=255;
      }
    }
  }
  checkDeadline();
  const image = new PNG({width,height}); image.data=rgba;
  return {png:PNG.sync.write(image),width,height,render_bounds:[[west,south],[east,north]] as [[number,number],[number,number]],bytes_read:budget.bytes_read};
}
