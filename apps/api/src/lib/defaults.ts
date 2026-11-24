/** Starting values for a brand-new academic year (used by the seed and "Start fresh"). */

export const COUNTER_KEYS = ['receipt', 'fund_request'] as const;

// The adviser can rename these and change what each position may do in Settings.
export const DEFAULT_DESIGNATIONS = [
  { name: 'President', canFileRequests: true, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1, seatsLocked: true },
  { name: 'Vice President', canFileRequests: false, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1, seatsLocked: true },
  { name: 'Secretary', canFileRequests: false, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1 },
  { name: 'Treasurer', canFileRequests: true, canCollect: true, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1 },
  { name: 'Auditor', canFileRequests: false, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1 },
  { name: 'Finance Officer', canFileRequests: true, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1 },
  { name: 'Collector', canFileRequests: false, canCollect: true, isConfidentialExempt: false, canViewFunds: true, maxMembers: 1 },
];

export function defaultPrivacyConsent(orgName = 'the organization') {
  return `By submitting this form, you agree that ${orgName} may collect and process your personal information (name, student number, course, year, section, and contact details) only to record and verify organization fund payments for this academic year, in accordance with Republic Act No. 10173, the Data Privacy Act of 2012. Your information will be stored securely, accessed only by authorized officers and the adviser, and will not be shared with third parties without your consent. You may request access to or correction of your data by contacting the organization adviser.`;
}
