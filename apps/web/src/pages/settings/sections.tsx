import { describePasswordPolicy, UPLOAD_MIME_TYPES, DATE_FORMATS, MAX_UPLOAD_BYTES, MIN_UPLOAD_BYTES, TWO_FACTOR_MODES, TWO_FACTOR_MODE_LABELS } from '@sft/shared';
import { Alert, Checkbox, Field, Input, RadioCards, Select, Textarea, Toggle } from '../../components/ui';
import { formatBytes } from '../../lib/format';
import type { Settings } from '../../lib/types';
import { SettingsCard } from './form';
import { ApproversManager, PositionsManager, ProgramsManager, SectionsManager } from './managers';

type Props = { settings: Settings };

const ORG_KEYS = ['orgName', 'orgAbbr', 'schoolName', 'schoolAbbr', 'collegeName', 'collegeAbbr', 'programName', 'programAbbr'] as const;
const STRUCTURE_KEYS = ['yearLevelCount'] as const;
const COLLECTION_KEYS = ['allowPartialPayments', 'allocationMode'] as const;
const APPROVAL_KEYS = ['requestApprovalRule', 'liquidationApprovalRule'] as const;
const RECEIPT_KEYS = ['receiptQrMessage', 'receiptFooterText'] as const;
const USAGE_KEYS = ['requireRequestAttachment', 'requireLiquidationAttachment'] as const;
const PUBLIC_KEYS = ['publicFields'] as const;
const REPORT_KEYS = ['reportHeaderText', 'reportPreparedByName', 'reportPreparedByTitle', 'reportNotedByName', 'reportNotedByTitle', 'reportPaperSize'] as const;
const EMAIL_KEYS = ['emailSenderName', 'emailSenderAddress', 'emailReplyTo'] as const;
const SECURITY_KEYS = ['passwordMinLength', 'passwordRequireUpper', 'passwordRequireNumber', 'passwordRequireSymbol', 'twofaMode'] as const;
const FILE_KEYS = ['uploadAllowedMime', 'uploadMaxBytes'] as const;
const LOCALE_KEYS = ['currency', 'timezone', 'dateFormat'] as const;
const PRIVACY_KEYS = ['privacyConsentText'] as const;

const asInt = (value: string) => (value === '' ? 0 : Number.parseInt(value.replace(/\D/g, ''), 10) || 0);

/** A text input bound to a nullable settings field (empty input = null). */
function NullableInput({ id, value, onChange, disabled, placeholder }: { id: string; value: string | null; onChange: (v: string | null) => void; disabled: boolean; placeholder?: string }) {
  return <Input id={id} value={value ?? ''} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value || null)} />;
}

export function StructureSection({ settings }: Props) {
  return (
    <>
      <SettingsCard title="Year levels" settings={settings} keys={STRUCTURE_KEYS}>
        {({ values, set, errors, readOnly }) => (
          <Field
            label="Number of year levels"
            htmlFor="yearLevelCount"
            error={errors.yearLevelCount}
            
            className="max-w-xs"
          >
            <Select id="yearLevelCount" value={values.yearLevelCount} disabled={readOnly} onChange={(e) => set('yearLevelCount', Number(e.target.value))}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} year level{n > 1 ? 's' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </SettingsCard>
      <ProgramsManager />
      <SectionsManager yearLevelCount={settings.yearLevelCount} />
    </>
  );
}

export function PositionsSection(_props: Props) {
  return <PositionsManager />;
}

export function CollectionSection({ settings }: Props) {
  return (
    <SettingsCard
      title="Collection"
      description="Overpayment is never allowed."
      settings={settings}
      keys={COLLECTION_KEYS}
    >
      {({ values, set, readOnly }) => (
        <>
          <Toggle
            id="allowPartialPayments"
            label="Allow partial payments"
            description="e.g. ₱50 of ₱500. When off, each fund must be paid in full."
            checked={values.allowPartialPayments}
            disabled={readOnly}
            onChange={(v) => set('allowPartialPayments', v)}
          />
          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">How a payment is split across funds</p>
            <RadioCards
              name="allocationMode"
              value={values.allocationMode}
              disabled={readOnly}
              onChange={(v) => set('allocationMode', v)}
              options={[
                {
                  value: 'hybrid',
                  label: 'Hybrid',
                  badge: 'Default',
                  description: 'The system fills funds in priority order, then staff can adjust. Allocations must add up to the amount paid.',
                },
                { value: 'priority_only', label: 'Priority only', description: 'Always filled in priority order. Staff can’t change it.' },
                { value: 'staff_chooses', label: 'Staff chooses', description: 'Staff enter how much goes to each fund.' },
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">Set the fund order on the Funds page.</p>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

const RULE_OPTIONS = [
  { value: 'any_one' as const, label: 'Any one approver', badge: 'Default', description: 'The first approval is enough.' },
  { value: 'all_required' as const, label: 'All approvers', description: 'The adviser and every extra approver must approve.' },
];

export function ApprovalsSection({ settings }: Props) {
  return (
    <>
      <SettingsCard
        title="Approval rules"
        description="One rejection rejects the request."
        settings={settings}
        keys={APPROVAL_KEYS}
      >
        {({ values, set, readOnly }) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-800">Fund requests</p>
              <RadioCards name="requestRule" value={values.requestApprovalRule} disabled={readOnly} onChange={(v) => set('requestApprovalRule', v)} options={RULE_OPTIONS} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-800">Liquidation receipts</p>
              <RadioCards
                name="liquidationRule"
                value={values.liquidationApprovalRule}
                disabled={readOnly}
                onChange={(v) => set('liquidationApprovalRule', v)}
                options={RULE_OPTIONS}
              />
            </div>
          </div>
        )}
      </SettingsCard>
      <ApproversManager />
    </>
  );
}

export function ReceiptsSection({ settings }: Props) {
  return (
    <>
      <SettingsCard title="Receipts" settings={settings} keys={RECEIPT_KEYS}>
        {({ values, set, errors, readOnly }) => (
          <>
            <Field label="Message under the QR code" htmlFor="receiptQrMessage" error={errors.receiptQrMessage}>
              <Input id="receiptQrMessage" value={values.receiptQrMessage} disabled={readOnly} onChange={(e) => set('receiptQrMessage', e.target.value)} />
            </Field>
            <Field label="Footer text" htmlFor="receiptFooterText" optional>
              <Textarea id="receiptFooterText" rows={2} value={values.receiptFooterText} disabled={readOnly} onChange={(e) => set('receiptFooterText', e.target.value)} />
            </Field>
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Transaction number</p>
              <p className="mt-1">
                Format <code className="rounded bg-surface px-1 ring-1 ring-slate-200">YYYY-MM-DD-####</code>, e.g. 2026-11-12-0011. The #### counter runs
                for the whole academic year and never resets daily.
              </p>
            </div>
          </>
        )}
      </SettingsCard>
    </>
  );
}

export function FundUsageSection({ settings }: Props) {
  return (
    <SettingsCard title="Fund usage" description="What requestors must attach." settings={settings} keys={USAGE_KEYS}>
      {({ values, set, readOnly }) => (
        <>
          <Toggle
            id="requireRequestAttachment"
            label="Require an attachment on fund requests"
            description="A photo or PDF of the physically approved request document."
            checked={values.requireRequestAttachment}
            disabled={readOnly}
            onChange={(v) => set('requireRequestAttachment', v)}
          />
          <Toggle
            id="requireLiquidationAttachment"
            label="Require a receipt upload after use"
            description="A photo or PDF of the official receipt."
            checked={values.requireLiquidationAttachment}
            disabled={readOnly}
            onChange={(v) => set('requireLiquidationAttachment', v)}
          />
        </>
      )}
    </SettingsCard>
  );
}

export function PublicPageSection({ settings }: Props) {
  return (
    <SettingsCard
      title="Public QR page"
      description="What anyone scanning a receipt QR sees. Keep it minimal."
      settings={settings}
      keys={PUBLIC_KEYS}
    >
      {({ values, set, readOnly }) => {
        type Extra = (typeof values.publicFields)[number];
        const has = (f: Extra) => values.publicFields.includes(f);
        const toggle = (f: Extra, on: boolean) =>
          set('publicFields', on ? [...values.publicFields.filter((x) => x !== f), f] : values.publicFields.filter((x) => x !== f));
        return (
          <div className="space-y-3">
            <Checkbox checked disabled onChange={() => {}} label="Student name" description="Always shown." />
            <Checkbox checked disabled onChange={() => {}} label="Status: Cleared (green) or Has Balance (red)" description="Always shown." />
            <Checkbox
              checked={has('breakdown')}
              disabled={readOnly}
              onChange={(v) => toggle('breakdown', v)}
              label="What’s paid and not yet paid, per fund"
              description="Confidential funds are combined into one “Restricted fee(s)” line."
            />
            <Checkbox
              checked={has('courseYearSection')}
              disabled={readOnly}
              onChange={(v) => toggle('courseYearSection', v)}
              label="Course, year and section"
            />
            <Checkbox
              checked={has('transactions')}
              disabled={readOnly}
              onChange={(v) => toggle('transactions', v)}
              label="Payment history with digital receipts"
              description="Every payment in the year, each with its receipt to view or download. Receipts show who processed the payment."
            />
            <p className="text-xs text-slate-500">Never shown: student number, staff notes or why a payment was voided.</p>
          </div>
        );
      }}
    </SettingsCard>
  );
}

export function ReportsSection({ settings }: Props) {
  return (
    <SettingsCard title="Printed reports" settings={settings} keys={REPORT_KEYS}>
      {({ values, set, readOnly }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Header text" htmlFor="reportHeaderText" optional className="sm:col-span-2">
            <Input id="reportHeaderText" value={values.reportHeaderText} disabled={readOnly} onChange={(e) => set('reportHeaderText', e.target.value)} />
          </Field>
          <Field label="Prepared by: name" htmlFor="prepName" optional>
            <NullableInput id="prepName" value={values.reportPreparedByName} disabled={readOnly} onChange={(v) => set('reportPreparedByName', v)} />
          </Field>
          <Field label="Prepared by: title" htmlFor="prepTitle" optional>
            <NullableInput id="prepTitle" value={values.reportPreparedByTitle} disabled={readOnly} placeholder="Treasurer" onChange={(v) => set('reportPreparedByTitle', v)} />
          </Field>
          <Field label="Noted by: name" htmlFor="notedName" optional>
            <NullableInput id="notedName" value={values.reportNotedByName} disabled={readOnly} onChange={(v) => set('reportNotedByName', v)} />
          </Field>
          <Field label="Noted by: title" htmlFor="notedTitle" optional>
            <NullableInput id="notedTitle" value={values.reportNotedByTitle} disabled={readOnly} placeholder="Adviser" onChange={(v) => set('reportNotedByTitle', v)} />
          </Field>
          <Field label="Paper size" htmlFor="paper">
            <Select id="paper" value={values.reportPaperSize} disabled={readOnly} onChange={(e) => set('reportPaperSize', e.target.value as Settings['reportPaperSize'])}>
              <option value="A4">A4</option>
              <option value="LETTER">Letter (8.5 × 11 in)</option>
              <option value="LEGAL">Legal (8.5 × 13 in)</option>
            </Select>
          </Field>
        </div>
      )}
    </SettingsCard>
  );
}

export function EmailSenderCard({ settings }: Props) {
  return (
    <SettingsCard
      title="Email sender"
      description="Who emails (receipts, approvals, password resets) appear to come from. The mail server login is configured on the server, not here. Some mail servers only accept their own address as the sender: then leave the sender email empty and set a reply-to."
      settings={settings}
      keys={EMAIL_KEYS}
    >
      {({ values, set, errors, readOnly }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="senderName" optional>
              <NullableInput id="senderName" value={values.emailSenderName} disabled={readOnly} placeholder="Your organization" onChange={(v) => set('emailSenderName', v)} />
            </Field>
            <Field label="Sender email" htmlFor="senderAddress" optional error={errors.emailSenderAddress}>
              <NullableInput id="senderAddress" value={values.emailSenderAddress} disabled={readOnly} onChange={(v) => set('emailSenderAddress', v)} />
            </Field>
            <Field label="Reply-to email" htmlFor="replyTo" optional error={errors.emailReplyTo}>
              <NullableInput id="replyTo" value={values.emailReplyTo} disabled={readOnly} onChange={(v) => set('emailReplyTo', v)} />
            </Field>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

export function SecuritySection({ settings }: Props) {
  return (
    <SettingsCard
      title="Security"
      description="Password rules apply to new passwords."
      settings={settings}
      keys={SECURITY_KEYS}
    >
      {({ values, set, errors, readOnly }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum password length" htmlFor="pwLen" error={errors.passwordMinLength} hint="8 to 128 characters">
              <Input id="pwLen" inputMode="numeric" value={values.passwordMinLength} disabled={readOnly} onChange={(e) => set('passwordMinLength', asInt(e.target.value))} />
            </Field>
          </div>
          <Toggle id="pwUpper" label="Require uppercase and lowercase letters" checked={values.passwordRequireUpper} disabled={readOnly} onChange={(v) => set('passwordRequireUpper', v)} />
          <Toggle id="pwNumber" label="Require a number" checked={values.passwordRequireNumber} disabled={readOnly} onChange={(v) => set('passwordRequireNumber', v)} />
          <Toggle id="pwSymbol" label="Require a symbol" checked={values.passwordRequireSymbol} disabled={readOnly} onChange={(v) => set('passwordRequireSymbol', v)} />
          <p className="text-xs text-slate-500">
            New passwords must have:{' '}
            {describePasswordPolicy({
              minLength: values.passwordMinLength,
              requireUpper: values.passwordRequireUpper,
              requireNumber: values.passwordRequireNumber,
              requireSymbol: values.passwordRequireSymbol,
            })
              .join(', ')
              .toLowerCase()}
            .
          </p>
          <Field
            label="Two-factor sign-in"
            htmlFor="twofa"
            hint="Members set it up in Profile. Turn it on for yourself before requiring it."
          >
            <Select id="twofa" value={values.twofaMode} disabled={readOnly} onChange={(e) => set('twofaMode', e.target.value as typeof values.twofaMode)}>
              {TWO_FACTOR_MODES.map((m) => (
                <option key={m} value={m}>
                  {TWO_FACTOR_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </SettingsCard>
  );
}

const MB = 1024 * 1024;
const SIZE_OPTIONS = [MIN_UPLOAD_BYTES, 1 * MB, 2 * MB, 5 * MB, 10 * MB, 20 * MB, 25 * MB, MAX_UPLOAD_BYTES];

const MIME_LABELS: Record<string, string> = { 'image/jpeg': 'JPEG images', 'image/png': 'PNG images', 'image/webp': 'WebP images', 'application/pdf': 'PDF documents' };

export function FilesSection({ settings }: Props) {
  return (
    <SettingsCard
      title="File uploads"
      description="For request attachments and receipts."
      settings={settings}
      keys={FILE_KEYS}
    >
      {({ values, set, errors, readOnly }) => (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-slate-800">Allowed types</legend>
            {UPLOAD_MIME_TYPES.map((mime) => (
              <Checkbox
                key={mime}
                checked={values.uploadAllowedMime.includes(mime)}
                disabled={readOnly}
                onChange={(on) => set('uploadAllowedMime', on ? [...values.uploadAllowedMime, mime] : values.uploadAllowedMime.filter((m) => m !== mime))}
                label={MIME_LABELS[mime]}
              />
            ))}
            {errors.uploadAllowedMime && <p className="text-sm text-red-600">{errors.uploadAllowedMime}</p>}
          </fieldset>
          <Field label="Maximum file size" htmlFor="maxSize" error={errors.uploadMaxBytes} className="max-w-xs">
            <Select id="maxSize" value={values.uploadMaxBytes} disabled={readOnly} onChange={(e) => set('uploadMaxBytes', Number(e.target.value))}>
              {[...new Set([values.uploadMaxBytes, ...SIZE_OPTIONS])]
                .sort((a, b) => a - b)
                .map((bytes) => (
                  <option key={bytes} value={bytes}>
                    {formatBytes(bytes)}
                  </option>
                ))}
            </Select>
          </Field>
        </>
      )}
    </SettingsCard>
  );
}

const TIMEZONES = ['Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'];

export function LocaleSection({ settings }: Props) {
  return (
    <SettingsCard
      title="Locale"
      description="Transaction numbers and receipt dates use this time zone."
      settings={settings}
      keys={LOCALE_KEYS}
    >
      {({ values, set, errors, readOnly }) => (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency" htmlFor="currency" error={errors.currency}>
            <Input id="currency" maxLength={3} value={values.currency} disabled={readOnly} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Time zone" htmlFor="timezone" error={errors.timezone}>
            <Select id="timezone" value={values.timezone} disabled={readOnly} onChange={(e) => set('timezone', e.target.value)}>
              {[...new Set([values.timezone, ...TIMEZONES])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date format" htmlFor="dateFormat">
            <Select id="dateFormat" value={values.dateFormat} disabled={readOnly} onChange={(e) => set('dateFormat', e.target.value)}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </SettingsCard>
  );
}

export function PrivacySection({ settings }: Props) {
  return (
    <SettingsCard
      title="Data privacy notice"
      description={`Shown at signup and on the student self-enrollment form (RA 10173, Data Privacy Act of 2012). Current version: ${settings.privacyConsentVersion}. Saving a new text starts a new version.`}
      settings={settings}
      keys={PRIVACY_KEYS}
    >
      {({ values, set, errors, readOnly }) => (
        <Field label="Notice text" htmlFor="privacy" error={errors.privacyConsentText}>
          <Textarea id="privacy" rows={10} value={values.privacyConsentText} disabled={readOnly} onChange={(e) => set('privacyConsentText', e.target.value)} />
        </Field>
      )}
    </SettingsCard>
  );
}
