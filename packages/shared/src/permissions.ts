export type AppRole = 'adviser' | 'member';
export type MembershipStatus = 'pending' | 'active' | 'rejected' | 'deactivated';

/**
 * What a member can do in one academic year.
 * - manage: adviser-only (settings, approvals, accounts, AY management, audit log)
 * - collect: record payments, enroll/approve students, issue receipts
 * - file_requests: file fund requests and liquidation receipts
 * - view_confidential: see confidential funds by name, with totals and requests
 */
export type Permission = 'manage' | 'collect' | 'file_requests' | 'view_confidential';

export interface DesignationFlags {
  canCollect: boolean;
  canFileRequests: boolean;
  isConfidentialExempt: boolean;
}

export interface MembershipLike {
  role: AppRole | null;
  status: MembershipStatus;
  designation?: DesignationFlags | null;
}

export const ALL_PERMISSIONS: Permission[] = ['manage', 'collect', 'file_requests', 'view_confidential'];

/** Permissions come from the member's position (designation); the adviser has all of them. */
export function permissionsFor(m: MembershipLike | null | undefined): Permission[] {
  if (!m || m.status !== 'active') return [];
  if (m.role === 'adviser') return [...ALL_PERMISSIONS];
  const d = m.designation;
  if (!d) return [];
  const perms: Permission[] = [];
  if (d.canCollect) perms.push('collect');
  if (d.canFileRequests) perms.push('file_requests');
  if (d.isConfidentialExempt) perms.push('view_confidential');
  return perms;
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  manage: 'Manage everything (adviser)',
  collect: 'Collect payments & manage students',
  file_requests: 'File fund requests',
  view_confidential: 'See confidential funds',
};
