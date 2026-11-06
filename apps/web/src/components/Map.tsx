import { useEffect, useRef } from 'react';
import L from 'leaflet';

export type SatelliteOverlay = { url: string; bounds: [[number, number], [number, number]]; opacity: number; label: string };

function validOverlay(overlay: SatelliteOverlay): boolean {
  const [[west,south],[east,north]]=overlay.bounds;
  if (![west,south,east,north].every(Number.isFinite)||west>=east||south>=north||west< -180||east>180||south< -90||north>90) return false;
  if (overlay.url.startsWith(`blob:${location.origin}/`)) return true;
  const url=new URL(overlay.url,location.origin);
  return url.origin===location.origin&&url.pathname.startsWith('/api/v1/imagery/queries/');
}

export default function PlotMap({ geometry, height = 320, generalizedRegion, overlay, showBaseMap=true, onOverlayError }: { geometry?: unknown; height?: number; generalizedRegion?: string; overlay?: SatelliteOverlay|null; showBaseMap?:boolean; onOverlayError?:()=>void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.GeoJSON | null>(null);
  const regionLayer = useRef<L.Circle | null>(null);
  const baseLayer = useRef<L.TileLayer|null>(null);
  const imageLayer = useRef<L.ImageOverlay|null>(null);
  const overlayError = useRef(onOverlayError);
  overlayError.current=onOverlayError;
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const tokens = getComputedStyle(document.documentElement);
      layer.current?.setStyle({ color: tokens.getPropertyValue('--ft-map-parcel').trim(), fillColor: tokens.getPropertyValue('--ft-map-parcel-fill').trim() });
      regionLayer.current?.setStyle({ color: tokens.getPropertyValue('--ft-map-parcel').trim() });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { zoomControl: true, scrollWheelZoom: false }).setView([-4.3, -59.4], 4);
    const pane=instance.createPane('satellite-imagery');pane.style.zIndex='350';pane.style.pointerEvents='none';
    baseLayer.current=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(instance);
    map.current = instance;
    return () => { instance.remove(); map.current = null; };
  }, []);
  useEffect(()=>{
    if(!map.current||!baseLayer.current)return;
    if(showBaseMap||generalizedRegion)baseLayer.current.addTo(map.current);
    else baseLayer.current.remove();
  },[showBaseMap,generalizedRegion]);
  const overlayBounds=overlay?JSON.stringify(overlay.bounds):'';
  useEffect(()=>{
    imageLayer.current?.remove();imageLayer.current=null;
    // Public maps never render precise imagery, even if a caller accidentally passes it.
    if(!map.current||generalizedRegion||!overlay)return;
    try {
      if(!validOverlay(overlay)){overlayError.current?.();return;}
      const [[west,south],[east,north]]=overlay.bounds;
      const image=L.imageOverlay(overlay.url,[[south,west],[north,east]],{pane:'satellite-imagery',opacity:overlay.opacity,interactive:false,alt:overlay.label,attribution:'INPE / Brazil Data Cube'});
      image.on('error',()=>{image.remove();overlayError.current?.();});
      image.addTo(map.current);imageLayer.current=image;
      return()=>{image.remove();if(imageLayer.current===image)imageLayer.current=null;};
    } catch {overlayError.current?.();}
  },[overlay?.url,overlayBounds,generalizedRegion]);
  useEffect(()=>{if(overlay)imageLayer.current?.setOpacity(Math.max(0,Math.min(1,overlay.opacity)));},[overlay?.opacity]);
  useEffect(() => {
    if (!map.current) return;
    layer.current?.remove();
    if (generalizedRegion) {
      map.current.setView([-14,-52], 3);
      const region = L.circle([-14,-52], { radius: 1500000, color: getComputedStyle(document.documentElement).getPropertyValue('--ft-map-parcel').trim(), fillOpacity: 0.08 }).addTo(map.current);
      regionLayer.current = region;
      return () => { region.remove(); regionLayer.current = null; };
    }
    if (!geometry) return;
    try {
      const tokens = getComputedStyle(document.documentElement);
      const next = L.geoJSON(geometry as GeoJSON.GeoJsonObject, { style: { color: tokens.getPropertyValue('--ft-map-parcel').trim(), fillColor: tokens.getPropertyValue('--ft-map-parcel-fill').trim(), fillOpacity: 0.36, weight: 3 } }).addTo(map.current);
      layer.current = next;
      if (next.getBounds().isValid()) map.current.fitBounds(next.getBounds(), { padding: [36, 36], maxZoom: 16 });
    } catch { /* The form displays geometry errors; never repair input silently. */ }
  }, [geometry, generalizedRegion]);
  return <div className="map-wrap" style={{height}}><div ref={container} style={{ height }} aria-label={generalizedRegion?'Mapa público da região generalizada':'Mapa da parcela declarada'} /><span className="map-caption">{generalizedRegion?`${generalizedRegion} · região pública generalizada; círculo ilustrativo sem localização da parcela`:`Contorno declarado${showBaseMap?' · mapa-base OpenStreetMap':''}${overlay?' · composição INPE':''}`}</span></div>;
}
