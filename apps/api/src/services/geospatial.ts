import type { Geometry } from '@foresttrace/contracts';

export interface GeometryValidation { valid: boolean; errors: string[]; areaHa?: number; rule_code: 'R01'; }
type Position = number[];
type Ring = Position[];
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!, b = ring[i + 1]!; sum += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return sum / 2;
}
function intersects(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => (q[0]!-p[0]!)*(r[1]!-p[1]!)-(q[1]!-p[1]!)*(r[0]!-p[0]!);
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function checkRing(ring: Ring, errors: string[], label: string) {
  if (ring.length < 4) errors.push(`${label}: mínimo quatro posições.`);
  const first=ring[0], last=ring.at(-1);
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) errors.push(`${label}: anel não fechado.`);
  for (const [index, pos] of ring.entries()) {
    if (pos.length < 2 || pos.length > 3 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || pos[0]! < -180 || pos[0]! > 180 || pos[1]! < -90 || pos[1]! > 90) errors.push(`${label}: coordenada inválida na posição ${index}.`);
  }
  for (let i=0;i<ring.length-1;i++) for(let j=i+1;j<ring.length-1;j++) {
    if (Math.abs(i-j) <= 1 || (i===0 && j===ring.length-2)) continue;
    if (intersects(ring[i]!,ring[i+1]!,ring[j]!,ring[j+1]!)) errors.push(`${label}: auto-interseção.`);
  }
}
/** Structural R01 checks only; final topology and geodesic area belong to PostGIS. */
export function validateGeometry(geometry: Geometry | unknown): GeometryValidation {
  const errors: string[]=[];
  const g=geometry as {type?: string;coordinates?: unknown};
  if (!g || !['Polygon','MultiPolygon'].includes(g.type ?? '') || !Array.isArray(g.coordinates)) return { valid:false, errors:['Geometria deve ser Polygon ou MultiPolygon.'], rule_code:'R01' };
  const polygons: unknown[] = g.type==='Polygon' ? [g.coordinates] : g.coordinates;
  if (!polygons.length) errors.push('Geometria sem polígonos.');
  polygons.forEach((poly, pi) => {
    if (!Array.isArray(poly) || !poly.length) { errors.push(`Polígono ${pi}: sem anel exterior.`); return; }
    poly.forEach((ring, ri) => Array.isArray(ring) ? checkRing(ring as Ring, errors, `Polígono ${pi}, anel ${ri}`) : errors.push(`Polígono ${pi}: anel inválido.`));
  });
  return { valid: errors.length===0, errors, rule_code:'R01' };
}
