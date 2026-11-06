import { describe, expect, it } from 'vitest';
import { reassessConversionWithException } from '../../src/services/conversion-review.js';

const input = { inputVolumeM3: '10', outputVolumeM3: '5', coefficient: '0.35', parameterVersion: 'SIMULADA-v1', parameterSource: 'Fixture sintética', parameterValidFrom: '2026-01-01', assessmentDate: '2026-11-06', species: 'Dinizia excelsa', product: 'serrado', exception: { coefficient: '0.50', approved: true, evidenceIds: ['approval'], validFrom: '2026-01-01', validUntil: '2026-12-31', species: 'Dinizia excelsa', product: 'serrado' } };

describe('aplicabilidade da exceção CRV', () => {
  it('aceita aprovação vigente e rejeita vencida, sem aprovação ou de produto incompatível', () => {
    expect(reassessConversionWithException(input)).toMatchObject({ result: 'PASSOU', exception_applied: true });
    for (const changes of [{ validUntil: '2026-11-05' }, { approved: false }, { evidenceIds: [] }, { product: 'carvão' }]) {
      expect(reassessConversionWithException({ ...input, exception: { ...input.exception, ...changes } })).toMatchObject({ result: 'ALERTA', exception_applied: false });
    }
  });
});
