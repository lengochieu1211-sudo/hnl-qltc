import React, { useEffect, useRef, useState } from 'react';
import { evaluateMathExpression, formatDecimal } from '../utils/numberUtils';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number | '';
  onValueChange: (value: number | '') => void;
  minValue?: number;
  maxValue?: number;
};

/**
 * Numeric input that also accepts formulas such as 2.4*5, 100/4, 10+2.
 * Invalid non-empty formulas set native HTML validity so forms cannot silently
 * submit the previous numeric value while the user sees an invalid expression.
 */
export const MathNumberInput: React.FC<Props> = ({
  value,
  onValueChange,
  minValue,
  maxValue,
  onBlur,
  onFocus,
  className,
  title,
  ...rest
}) => {
  const [text, setText] = useState(value === '' ? '' : formatDecimal(value));
  const [invalid, setInvalid] = useState(false);
  const focusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusedRef.current) setText(value === '' ? '' : formatDecimal(value));
  }, [value]);

  const clamp = (n: number) => {
    let next = n;
    if (typeof minValue === 'number') next = Math.max(minValue, next);
    if (typeof maxValue === 'number') next = Math.min(maxValue, next);
    return next;
  };

  const updateValidity = (raw: string) => {
    const trimmed = raw.trim();
    const parsed = trimmed ? evaluateMathExpression(trimmed) : null;
    const isInvalid = Boolean(trimmed) && (parsed === null || !Number.isFinite(parsed));
    setInvalid(isInvalid);
    inputRef.current?.setCustomValidity(isInvalid ? 'Công thức hoặc số nhập không hợp lệ.' : '');
    return { parsed, isInvalid };
  };

  const commit = () => {
    if (!text.trim()) {
      setInvalid(false);
      inputRef.current?.setCustomValidity('');
      onValueChange('');
      return;
    }
    const { parsed, isInvalid } = updateValidity(text);
    if (isInvalid || parsed === null || !Number.isFinite(parsed)) return;
    const next = clamp(parsed);
    onValueChange(next);
    setText(formatDecimal(next));
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      aria-invalid={invalid || undefined}
      title={invalid ? 'Công thức không hợp lệ. Ví dụ: 100*5, 1220/3, (50+20)*2' : title}
      className={`${className || ''} ${invalid ? 'border-rose-400 ring-1 ring-rose-300 focus:ring-rose-500' : ''}`.trim()}
      onFocus={(e) => {
        focusedRef.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        const nextText = e.target.value;
        setText(nextText);
        const { parsed, isInvalid } = updateValidity(nextText);
        if (!isInvalid && parsed !== null && Number.isFinite(parsed)) onValueChange(clamp(parsed));
        else if (!nextText.trim()) onValueChange('');
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        commit();
        onBlur?.(e);
      }}
    />
  );
};
