import React, { useState } from 'react';
import { evaluateMathExpression, formatAdaptiveDecimal } from '../utils/numberUtils';

/**
 * Shared view for an existing, PERSISTED raw numeric string/expression.
 * Keeps value + onChange fully controlled by the owning form: unlike a separate
 * result field, a focus/blur cycle cannot overwrite the user's source formula.
 * Callers must keep the raw expression in their existing persistence path.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: string;
  formatResult?: (value: number) => string;
};

export const ExpressionDisplayInput: React.FC<Props> = ({
  value,
  formatResult = formatAdaptiveDecimal,
  onFocus,
  onBlur,
  inputMode = 'decimal',
  ...inputProps
}) => {
  const [focused, setFocused] = useState(false);
  const raw = value ?? '';
  const calculated = raw.trim() ? evaluateMathExpression(raw) : null;
  const displayed = !focused && calculated !== null && Number.isFinite(calculated)
    ? formatResult(calculated)
    : raw;

  return <input
    {...inputProps}
    type="text"
    inputMode={inputMode}
    value={displayed}
    title={inputProps.title || (calculated !== null && raw.trim() !== displayed ? `Công thức: ${raw}` : undefined)}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
  />;
};
