import { ROLE_NAMES } from '@foresttrace/contracts';

type Role = typeof ROLE_NAMES[number];

type MembershipUser = { id: string; organization_id: string; roles: string[] };
type Membership = { user_id: string; organization_id: string; role: string };

/** Both the user's enabled roles and a membership in the active organization are required. */
export function effectiveMembershipRoles(user: MembershipUser, memberships: Membership[]): Role[] {
  const scopedRoles = new Set(memberships
    .filter(membership => membership.user_id === user.id && membership.organization_id === user.organization_id)
    .map(membership => membership.role));
  return ROLE_NAMES.filter(role => user.roles.includes(role) && scopedRoles.has(role));
}
