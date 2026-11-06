import { describe, expect, it } from 'vitest';
import { canAccessCommercialDocument, changeDocumentGrant } from '../../src/services/commercial-access.js';
import { reassessConversionWithException } from '../../src/services/conversion-review.js';

describe('commercial document grants', () => {
  it('requires a grant for buyer or auditor organizations and supports revocation', () => {
    const granted = changeDocumentGrant([], 'buyer-org', 'grant');
    expect(canAccessCommercialDocument({ ownerOrganizationId: 'owner', requesterOrganizationId: 'buyer-org', requesterRoles: ['BUYER'], grantedOrganizationIds: granted })).toBe(true);
    expect(canAccessCommercialDocument({ ownerOrganizationId: 'owner', requesterOrganizationId: 'outside', requesterRoles: ['BUYER'], grantedOrganizationIds: granted })).toBe(false);
    expect(canAccessCommercialDocument({ ownerOrganizationId: 'owner', requesterOrganizationId: 'buyer-org', requesterRoles: ['OPERATOR'], grantedOrganizationIds: granted })).toBe(false);
    expect(changeDocumentGrant(granted, 'buyer-org', 'revoke')).toEqual([]);
  });
});

describe('CRV exception reassessment', () => {
  const base = { inputVolumeM3: '10', outputVolumeM3: '5', coefficient: '0.35', parameterVersion: 'v1', parameterSource: 'demo', parameterValidFrom: '2025-01-01', assessmentDate: '2026-01-01', species: 'angelim', product: 'serrado' };
  it('applies an in-scope, evidenced, current exception and retains the original check outside the result', () => {
    expect(reassessConversionWithException({ ...base, exception: { coefficient: '0.50', approved: true, evidenceIds: ['doc'], validFrom: '2025-01-01', validUntil: '2027-01-01', species: 'angelim', product: 'serrado' } })).toMatchObject({ result: 'PASSOU', exception_applied: true, multiplier: '0.5' });
  });
  it('rejects missing approval, stale validity and mismatched species or product', () => {
    for (const exception of [
      { coefficient: '0.50', approved: false, evidenceIds: [], validFrom: '2025-01-01', validUntil: '2027-01-01', species: 'angelim', product: 'serrado' },
      { coefficient: '0.50', approved: true, evidenceIds: ['doc'], validFrom: '2024-01-01', validUntil: '2025-01-01', species: 'angelim', product: 'serrado' },
      { coefficient: '0.50', approved: true, evidenceIds: ['doc'], validFrom: '2025-01-01', validUntil: '2027-01-01', species: 'jatoba', product: 'serrado' },
      { coefficient: '0.50', approved: true, evidenceIds: ['doc'], validFrom: '2025-01-01', validUntil: '2027-01-01', species: 'angelim', product: 'laminado' },
    ]) expect(reassessConversionWithException({ ...base, exception }).result).toBe('ALERTA');
  });
});
