import { Check, Circle } from 'lucide-react';
import { DEFAULT_PASSWORD_POLICY, describePasswordPolicy, passwordIssues, type PasswordPolicy } from '@sft/shared';
import { cx } from './ui';

/** Live list of password rules (from the AY's security settings). */
export function PasswordChecklist({ password, policy = DEFAULT_PASSWORD_POLICY }: { password: string; policy?: PasswordPolicy }) {
  const unmet = new Set(passwordIssues(password, policy));
  return (
    <ul className="space-y-1 text-xs" aria-label="Password requirements">
      {describePasswordPolicy(policy).map((rule) => {
        const ok = password.length > 0 && !unmet.has(rule);
        return (
          <li key={rule} className={cx('flex items-center gap-1.5', ok ? 'text-emerald-700' : 'text-slate-500')}>
            {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3" aria-hidden />}
            {rule}
            <span className="sr-only">{ok ? '(met)' : '(not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
