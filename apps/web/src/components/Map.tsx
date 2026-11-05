import { useEffect, useRef } from 'react';
import L from 'leaflet';

export default function PlotMap({ geometry, height = 320 }: { geometry?: unknown; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { zoomControl: true, scrollWheelZoom: false }).setView([-4.3, -59.4], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(instance);
    map.current = instance;
    return () => { instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    layer.current?.remove();
    if (!geometry) return;
    try {
      const next = L.geoJSON(geometry as GeoJSON.GeoJsonObject, { style: { color: '#244d34', fillColor: '#a3bd75', fillOpacity: 0.36, weight: 3 } }).addTo(map.current);
      layer.current = next;
      if (next.getBounds().isValid()) map.current.fitBounds(next.getBounds(), { padding: [36, 36], maxZoom: 16 });
    } catch { /* The form displays geometry errors; never repair input silently. */ }
  }, [geometry]);
  return <div className="map-wrap"><div ref={container} style={{ height }} aria-label="Mapa da parcela declarada" /><span className="map-caption">Contorno declarado · mapa-base OpenStreetMap</span></div>;
}
