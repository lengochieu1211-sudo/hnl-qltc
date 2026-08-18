import React, { useEffect, useRef, useState } from 'react';
import { evaluateMathExpression, formatDecimal } from '../utils/numberUtils';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number | '';
  onValueChange: (value: number | '') => void;
  minValue?: number;
  maxValue?: number;
};

/** Numeric input that also accepts formulas such as 2.4*5, 100/4, 10+2. */
export const MathNumberInput: React.FC<Props> = ({ value, onValueChange, minValue, maxValue, onBlur, onFocus, ...rest }) => {
  const [text, setText] = useState(value === '' ? '' : String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(value === '' ? '' : String(value));
  }, [value]);

  const clamp = (n: number) => {
    let next = n;
    if (typeof minValue === 'number') next = Math.max(minValue, next);
    if (typeof maxValue === 'number') next = Math.min(maxValue, next);
    return next;
  };

  const commit = () => {
    if (!text.trim()) {
      onValueChange('');
      return;
    }
    const parsed = evaluateMathExpression(text);
    if (parsed === null || !Number.isFinite(parsed)) return;
    const next = clamp(parsed);
    onValueChange(next);
    setText(formatDecimal(next));
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        focusedRef.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        const nextText = e.target.value;
        setText(nextText);
        const parsed = evaluateMathExpression(nextText);
        if (parsed !== null && Number.isFinite(parsed)) onValueChange(clamp(parsed));
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
