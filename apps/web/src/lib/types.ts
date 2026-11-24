import type { AppRole, EventDefinition, EventTemplate, MembershipStatus, PasswordPolicy, Permission } from '@sft/shared';

export interface AyEntry {
  id: string;
  label: string;
  status: 'open' | 'closed';
  isCurrent: boolean;
  orgName: string;
  orgAbbr: string;
  logoUrl: string | null;
  needsSetup: boolean;
  hasAdviser: boolean;
  /** off | optional | required */
  twoFactorMode: 'off' | 'optional' | 'required';
  membership: {
    id: string;
    role: AppRole | null;
    status: MembershipStatus;
    position: string | null;
    permissions: Permission[];
  } | null;
}

export interface Me {
  user: {
    id: string;
    email: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    suffix: string | null;
    contactNo: string | null;
    name: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    avatarUrl: string | null;
    isSuperadmin: boolean;
    /** given a starting password by the superadmin: must set their own first */
    mustChangePassword: boolean;
  };
  currentAyId: string | null;
  academicYears: AyEntry[];
}

export interface PublicInfo {
  initialized: boolean;
  academicYear?: { label: string; status: string };
  org?: { name: string; abbr: string; school: string; schoolAbbr: string; college: string; collegeAbbr: string; logoUrl: string | null };
  privacyConsentText?: string;
  passwordPolicy?: PasswordPolicy;
  passwordRules?: string[];
}

export interface Member {
  id: string;
  status: MembershipStatus;
  role: AppRole | null;
  designation: { id: string; name: string } | null;
  position: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  deactivatedAt: string | null;
  deactivatedByName: string | null;
  isSelf: boolean;
  user: { id: string; name: string; email: string; contactNo: string | null; emailVerified: boolean; avatarUrl: string | null };
}

export interface Designation {
  id: string;
  name: string;
  canFileRequests: boolean;
  canCollect: boolean;
  isConfidentialExempt: boolean;
  canViewFunds: boolean;
  /** how many members may hold it at once; null = no limit */
  maxMembers: number | null;
  /** fixed at one person (President, Vice President) */
  seatsLocked: boolean;
  isActive: boolean;
  /** members holding it now */
  activeMembers?: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorDesignation: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  academicYear: string | null;
  actorRole: string | null;
  device: string | null;
}

/** The adviser's activity log: student and staff changes in plain words. */
export interface ActivityEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorDesignation: string | null;
  kind: 'student' | 'staff';
  summary: string;
  details: string[];
}

export interface AdminAy {
  id: string;
  label: string;
  status: 'open' | 'closed';
  isCurrent: boolean;
  hasSettings: boolean;
}

export interface AdviserRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  academicYear: { id: string; label: string };
  status: 'pending' | 'active' | 'rejected' | 'deactivated';
  mustChangePassword: boolean;
  addedAt: string | null;
  addedByName: string | null;
  lastLoginAt: string | null;
}

export interface VisitRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  device: string;
  ipAddress: string | null;
  startedAt: string;
  endedAt: string | null;
  lastSeenAt: string;
  online: boolean;
  minutes: number;
}

export interface ActivityReport {
  from: string;
  to: string;
  offlineAfterMinutes: number;
  online: VisitRow[];
  visits: VisitRow[];
  people: { userId: string; name: string; email: string; role: string; hours: number; visits: number; lastSeenAt: string; online: boolean }[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
}

export interface NotificationEventView extends EventDefinition {
  defaultTemplate: EventTemplate;
  template: EventTemplate;
  customized: boolean;
  inApp: boolean;
  email: boolean;
}

export interface NotificationSettings {
  smtpConfigured: boolean;
  sender: { from: string; replyTo?: string };
  events: NotificationEventView[];
}

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  eventKey: string | null;
  eventLabel: string | null;
  status: EmailStatus;
  attempts: number;
  retryable: boolean;
  lastError: string | null;
  nextTryAt: string | null;
  createdAt: string;
  sentAt: string | null;
  requestedByName: string | null;
  text?: string | null;
}

export interface Settings {
  academicYearId: string;
  schoolName: string;
  schoolAbbr: string;
  collegeName: string;
  collegeAbbr: string;
  orgName: string;
  orgAbbr: string;
  programName: string | null;
  programAbbr: string | null;
  logoUrl: string | null;
  receiptLogoUrl: string | null;
  yearLevelCount: number;
  allowPartialPayments: boolean;
  allocationMode: 'hybrid' | 'priority_only' | 'staff_chooses';
  requestApprovalRule: 'any_one' | 'all_required';
  liquidationApprovalRule: 'any_one' | 'all_required';
  receiptFooterText: string;
  receiptQrMessage: string;
  requireRequestAttachment: boolean;
  requireLiquidationAttachment: boolean;
  publicFields: ('breakdown' | 'courseYearSection' | 'transactions')[];
  reportHeaderText: string;
  reportPreparedByName: string | null;
  reportPreparedByTitle: string | null;
  reportNotedByName: string | null;
  reportNotedByTitle: string | null;
  reportPaperSize: 'A4' | 'LETTER' | 'LEGAL';
  emailSenderName: string | null;
  emailSenderAddress: string | null;
  emailReplyTo: string | null;
  passwordMinLength: number;
  passwordRequireUpper: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  twofaMode: 'off' | 'optional' | 'required';
  uploadAllowedMime: string[];
  uploadMaxBytes: number;
  currency: string;
  timezone: string;
  dateFormat: string;
  privacyConsentText: string;
  privacyConsentVersion: string;
  updatedAt: string;
  updatedByName: string | null;
}

export interface Program {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface Section {
  id: string;
  name: string;
  isActive: boolean;
}

export interface PositionRow extends Designation {
  sortOrder: number;
  activeMembers: number;
}

export interface ApproverRow {
  userId: string;
  name: string;
  position: string | null;
  active: boolean;
  approvesFundRequests: boolean;
  approvesLiquidations: boolean;
  addedByName: string | null;
}

export interface AyListItem {
  id: string;
  label: string;
  status: 'open' | 'closed';
  isCurrent: boolean;
  needsSetup: boolean;
  orgName: string | null;
  adviserName: string | null;
  activeMembers: number;
  pendingMembers: number;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  copiedFrom: { label: string; at: string; by: string } | null;
  iAmAdviser: boolean;
}

export interface SetupPreview {
  target: { id: string; label: string };
  source: { id: string; label: string; status: string } | null;
  adviser: { name: string; willCopy: boolean } | null;
  staff: { people: { name: string; position: string | null }[] } | null;
  settings: { orgName: string; designations: number; programs: number; sections: number; approvers: number } | null;
  funds: { items: { name: string; amountPerStudent: number; isMandatory: boolean; isConfidential: boolean }[] } | null;
  carryOver: { items: { fundName: string; label: string; amount: number; committed: number }[]; total: number } | null;
  students: { promotable: number; graduating: number } | null;
  defaults: { designations: string[] } | null;
  warnings: string[];
}

export interface SetupSummary {
  settingsCopied: boolean;
  designations: number;
  programs: number;
  sections: number;
  approvers: number;
  adviserCopied: boolean;
  staff: number;
  funds: number;
  carryOver: { entries: number; total: number };
  students: number;
  skipped: string[];
}

export type StudentStatus = 'active' | 'pending' | 'inactive' | 'rejected';

export interface Student {
  id: string;
  studentNumber: string;
  name: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  program: { id: string; code: string; name: string };
  yearLevel: number;
  section: { id: string; name: string } | null;
  email: string | null;
  contactNo: string | null;
  status: StudentStatus;
  source: 'manual' | 'csv_import' | 'self_enroll' | 'promoted';
  needsProfileConfirmation: boolean;
  profileConfirmedAt: string | null;
  profileConfirmedByName: string | null;
  duplicateFlag: 'exact' | 'similar' | null;
  duplicateOverride: boolean;
  duplicateOverrideByName: string | null;
  duplicateOverrideReason: string | null;
  consentGivenAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionComment: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** list views only */
  clearance?: { isCleared: boolean; totalBalance: number; totalDue: number } | null;
}

export interface DuplicateMatch {
  id: string;
  studentNumber: string;
  name: string;
  program: string;
  yearLevel: number;
  section: string | null;
  status: StudentStatus;
  strength: 'exact' | 'similar';
  overrideReason: string | null;
}

export interface StudentProfile {
  student: Student;
  duplicates: DuplicateMatch[];
  qr: { token: string; verifyPath: string; createdAt: string } | null;
  promotedFrom: { academicYear: string; courseYearSection: string } | null;
  account: StudentAccount;
  history: { id: string; action: string; actorName: string; actorDesignation: string | null; createdAt: string; before: unknown; after: unknown }[];
}

export interface StudentMeta {
  programs: { id: string; code: string; name: string }[];
  sections: { id: string; name: string }[];
  yearLevelCount: number;
  canOverrideDuplicates: boolean;
}

export interface StudentSummary {
  active: number;
  pending: number;
  inactive: number;
  rejected: number;
  needsConfirmation: number;
  duplicateGroups: number;
}

export interface EnrollmentLinkRow {
  id: string;
  token: string;
  path: string;
  label: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  isActive: boolean;
  usable: boolean;
  createdByName: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByName: string | null;
  pending: number;
}

export interface ImportRow {
  line: number;
  status: 'ok' | 'similar' | 'exact' | 'error';
  messages: string[];
  values: Record<string, string>;
}

export interface ImportAnalysis {
  rows: ImportRow[];
  counts: { total: number; ok: number; similar: number; exact: number; error: number };
}

export interface FundStats {
  students: number;
  totalDue: number;
  collected: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  balance: number;
  committed: number;
  available: number;
}

export interface Fund {
  id: string;
  name: string;
  notes: string | null;
  amountPerStudent: number;
  isConfidential: boolean;
  isMandatory: boolean;
  allPrograms: boolean;
  programs: { id: string; code: string }[];
  yearLevels: number[];
  priority: number;
  isActive: boolean;
  copiedFromFundId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  stats: FundStats;
  amountLocked: boolean;
}

export interface ChargeSync {
  added: number;
  reactivated: number;
  cancelled: number;
  keptWithPayments: number;
}

export interface LedgerEntry {
  id: string;
  entryType: 'collection' | 'usage' | 'carry_over' | 'adjustment' | 'void';
  amount: number;
  balanceAfter: number;
  label: string;
  transactionNo: string | null;
  studentName: string | null;
  reverses: string | null;
  createdByName: string;
  createdByDesignation: string | null;
  createdAt: string;
}

export interface StudentChargeRow {
  chargeId: string;
  fundId: string | null;
  fundName: string;
  restricted: boolean;
  isMandatory: boolean;
  priority: number;
  amountDue: number;
  amountPaid: number;
  balance: number;
  status: 'unpaid' | 'partial' | 'paid';
}

export interface StudentAccount {
  charges: StudentChargeRow[];
  totals: { due: number; paid: number; balance: number };
  isCleared: boolean;
}

export interface Receipt {
  id: string;
  transactionNo: string;
  status: 'posted' | 'voided';
  amount: number;
  receivedAt: string;
  academicYear: string;
  timezone: string;
  student: { id: string; name: string; studentNumber: string; courseYearSection: string };
  allocations: { fundName: string; amount: number; remainingOnFund: number }[];
  balanceBefore: number;
  balanceAfter: number;
  clearedAfter: boolean;
  processedByName: string;
  processedByDesignation: string | null;
  qrUrl: string;
  notes: string | null;
  org: { name: string; abbr: string; school: string; college: string; logoUrl: string | null };
  qrMessage: string;
  footer: string;
  voided: { at: string; byName: string; reason: string } | null;
}

export interface PaymentOptions {
  allocationMode: 'hybrid' | 'priority_only' | 'staff_chooses';
  allowPartialPayments: boolean;
  timezone: string;
}

export interface PaymentRow {
  id: string;
  transactionNo: string;
  receivedAt: string;
  amount: number;
  balanceAfter: number;
  status: 'posted' | 'voided';
  studentName: string;
  processedByName: string;
}

export interface VerifyYear {
  academicYearId: string;
  academicYear: string;
  status: 'cleared' | 'has_balance';
  courseYearSection?: string;
  breakdown?: { fund: string; amountDue: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid'; restricted: boolean }[];
  totals?: { due: number; paid: number; balance: number };
  transactions?: { id: string; transactionNo: string; receivedAt: string; amount: number; status: 'posted' | 'voided'; funds: string[] }[];
}

export interface VerifyResult {
  name: string;
  /** with every year shown: cleared only when all of them are */
  status: 'cleared' | 'has_balance';
  org: { name: string; logoUrl: string | null };
  checkedAt: string;
  academicYears: { id: string; label: string }[];
  selected: string;
  years: VerifyYear[];
}

export type FundRequestStatus = 'pending' | 'approved' | 'rejected' | 'receipt_submitted' | 'revision_requested' | 'settlement_due' | 'cleared' | 'canceled';

export interface AttachedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface Decision {
  approverName: string;
  approverDesignation: string | null;
  decision: 'approved' | 'rejected' | 'revision_requested';
  comment: string | null;
  decidedAt: string;
}

export interface Liquidation {
  id: string;
  version: number;
  status: 'submitted' | 'revision_requested' | 'approved';
  approvedAmount: number;
  fundUsed: number;
  overApproved: boolean;
  overApprovedAccepted: boolean;
  overAcceptedByName: string | null;
  remarks: string | null;
  submittedAt: string;
  submittedByName: string;
  revisionMessage: string | null;
  revisionRequestedAt: string | null;
  revisionRequestedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  /** what approving took out of the fund (null until approved) */
  chargedAmount: number | null;
  /** the difference with the cash advance: reimbursed to, or returned by, the requestor */
  settlement: Settlement | null;
  /** the adviser approved a receipt for their own request */
  selfApproved: boolean;
  decisions: Decision[];
  receipts: LiquidationReceiptEntry[];
  attachments: AttachedFile[];
}

export interface Settlement {
  kind: 'reimburse' | 'return';
  amount: number;
  settledAt: string | null;
  settledByName: string | null;
  settledByDesignation: string | null;
  note: string | null;
  file: AttachedFile | null;
}

export interface LiquidationReceiptEntry {
  id: string;
  /** R-1, R-2… */
  ref: string;
  usedFor: string;
  payee: string | null;
  receiptNo: string | null;
  /** yyyy-mm-dd */
  receiptDate: string;
  total: number;
  items: { description: string; quantity: number; unitCost: number; amount: number }[];
  attachments: AttachedFile[];
}

export interface FundRequestDetail {
  id: string;
  requestNo: string;
  status: FundRequestStatus;
  statusLabel: string;
  fund: { id: string; name: string; isConfidential: boolean };
  requestorId: string;
  requestorName: string;
  requestorDesignation: string;
  amount: number;
  purpose: string;
  useAt: string;
  approvalRule: 'any_one' | 'all_required';
  submittedAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  approvedByDesignation: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionComment: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  cancelReason: string | null;
  clearedAt: string | null;
  archivedAt: string | null;
  archivedByName: string | null;
  /** the adviser approved their own request */
  selfApproved: boolean;
  decisions: Decision[];
  attachments: AttachedFile[];
  liquidations: Liquidation[];
}

export interface ApproverProgress {
  name: string;
  designation: string;
  decision: string | null;
  isRequestor: boolean;
}

export interface FundRequestView {
  request: FundRequestDetail;
  /** null when the viewer may not see funds and does not approve this request */
  fund: { balance: number; committed: number; available: number } | null;
  approvals: {
    request: ApproverProgress[];
    liquidation: ApproverProgress[];
  };
  viewer: {
    isRequestor: boolean;
    canDecide: boolean;
    canCancel: boolean;
    canSubmitReceipt: boolean;
    canReviewReceipt: boolean;
    /** treasurer/adviser: record the reimbursement or the returned change */
    canSettle: boolean;
    noApprovers: boolean;
    canArchive: boolean;
    canUnarchive: boolean;
  };
}

export interface FundRequestRow {
  id: string;
  requestNo: string;
  status: FundRequestStatus;
  statusLabel: string;
  fundName: string;
  isConfidential: boolean;
  amount: number;
  purpose: string;
  useAt: string;
  requestorName: string;
  requestorDesignation: string;
  submittedAt: string;
  approvedAt: string | null;
  fundUsed: number | null;
  receiptSubmittedAt: string | null;
  receiptApprovedAt: string | null;
  archivedAt: string | null;
  needsMyAction: boolean;
}

export interface FundRequestOptions {
  canFile: boolean;
  requestor: { name: string; designation: string | null };
  funds: { id: string; name: string; isConfidential: boolean; balance: number; committed: number; available: number }[];
  requireRequestAttachment: boolean;
  requireLiquidationAttachment: boolean;
  uploadAllowedMime: string[];
  uploadMaxBytes: number;
}
