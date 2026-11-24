import { useEffect, useState } from 'react';
import { centavosToInput, parsePesos } from '@sft/shared';
import { Input } from './ui';

/**
 * A peso amount field. Shows what the user types; reports integer centavos (or null when
 * the text isn't a valid amount). No floating-point math touches the value.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  disabled,
  allowNegative,
  invalid,
  ariaLabel,
}: {
  id: string;
  value: number | null;
  onChange: (centavos: number | null) => void;
  disabled?: boolean;
  allowNegative?: boolean;
  invalid?: boolean;
  /** for fields without a visible <label> */
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : centavosToInput(value));

  // follow outside changes (e.g. the form resets) without fighting the user's typing
  useEffect(() => {
    if (value === null || parsePesos(text) !== value) setText(value === null ? '' : centavosToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = text.trim() === '' ? null : parsePesos(text);
  const bad = text.trim() !== '' && (parsed === null || (!allowNegative && parsed < 0));

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₱</span>
      <Input
        id={id}
        inputMode="decimal"
        className="pl-7 tabular-nums"
        value={text}
        disabled={disabled}
        invalid={invalid || bad}
        placeholder="0.00"
        aria-label={ariaLabel}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.trim() === '' ? null : parsePesos(e.target.value);
          onChange(next !== null && !allowNegative && next < 0 ? null : next);
        }}
      />
    </div>
  );
}
