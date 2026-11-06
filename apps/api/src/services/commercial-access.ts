export type DocumentGrant = { organizationId: string; roles: string[] };

/** A buyer or auditor needs an explicit grant from the document owner. */
export function canAccessCommercialDocument(input: {
  ownerOrganizationId: string;
  requesterOrganizationId: string;
  requesterRoles: string[];
  grantedOrganizationIds: string[];
}): boolean {
  if (input.ownerOrganizationId === input.requesterOrganizationId) return true;
  return input.grantedOrganizationIds.includes(input.requesterOrganizationId)
    && input.requesterRoles.some(role => role === 'BUYER' || role === 'AUDITOR');
}

export const canAccessCommercialPassport = canAccessCommercialDocument;

export function changeDocumentGrant(current: string[], organizationId: string, action: 'grant' | 'revoke'): string[] {
  if (action === 'grant') return [...new Set([...current, organizationId])].sort();
  return current.filter(id => id !== organizationId);
}
