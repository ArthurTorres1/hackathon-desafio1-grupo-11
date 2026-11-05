import { expect, it } from 'vitest';
import { validateGeometry } from '../../src/services/geospatial.js';

it('R01 accepts a closed numeric polygon and rejects open/self-intersecting rings',()=>{
  const good={type:'Polygon',coordinates:[[[-60,-3],[-59.9,-3],[-59.9,-2.9],[-60,-2.9],[-60,-3]]]};
  expect(validateGeometry(good).valid).toBe(true);
  const open={type:'Polygon',coordinates:[[[-60,-3],[-59.9,-3],[-59.9,-2.9],[-60,-2.9]]]};
  expect(validateGeometry(open).errors.join(' ')).toContain('não fechado');
  const crossing={type:'Polygon',coordinates:[[[-60,-3],[-59.9,-2.9],[-60,-2.9],[-59.9,-3],[-60,-3]]]};
  expect(validateGeometry(crossing).errors.join(' ')).toContain('auto-interseção');
  const outOfBounds={type:'Polygon',coordinates:[[[181,-3],[179,-3],[179,-2],[181,-2],[181,-3]]]};
  expect(validateGeometry(outOfBounds).errors.join(' ')).toContain('coordenada inválida');
});
