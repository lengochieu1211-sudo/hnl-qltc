import { useState, useEffect } from 'react';

/**
 * React hook to subscribe to app format settings changes
 * and trigger re-renders when number or date formats are updated.
 */
export function useFormatSettings() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const handleSettingsChange = () => {
      setTick((t) => t + 1);
    };
    window.addEventListener('app_settings_changed', handleSettingsChange);
    return () => {
      window.removeEventListener('app_settings_changed', handleSettingsChange);
    };
  }, []);
}

/**
 * Utility functions for numeric calculations, parsing math expressions,
 * and smart decimal formatting with user settings support.
 */

export type NumberFormatPreset = 'dot_comma' | 'comma_dot';

/**
 * Gets the configured number format preset from localStorage.
 * 'dot_comma': Thousands = '.', Decimal = ',' (VN/EU: 1.234.567,89)
 * 'comma_dot': Thousands = ',', Decimal = '.' (US/INT: 1,234,567.89)
 */
export function getNumberFormatPreset(): NumberFormatPreset {
  if (typeof window === 'undefined') return 'comma_dot';
  const saved = localStorage.getItem('app_number_format_preset');
  return saved === 'dot_comma' ? 'dot_comma' : 'comma_dot';
}

/**
 * Saves the number format preset and dispatches an event to notify UI components.
 */
export function setNumberFormatPreset(preset: NumberFormatPreset): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('app_number_format_preset', preset);
  window.dispatchEvent(new Event('app_settings_changed'));
}

/**
 * Formats a number according to the user's number format setting.
 * Maximum 2 decimal places for display only. Stored/calculated values are not rounded.
 */
export function formatDecimal(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === '') return '0';
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return '0';

  const preset = getNumberFormatPreset();
  const locale = preset === 'comma_dot' ? 'en-US' : 'vi-VN';

  if (Number.isInteger(num)) {
    return num.toLocaleString(locale);
  }
  
  // Display only: keep at most 2 decimal places. Do not mutate the stored/calculated value.
  return num.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/**
 * Formats currency in VND with maximum 2 fraction digits using configured number format.
 */
export function formatVND(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === '') return '0 đ';
  return formatDecimal(val) + ' đ';
}

/**
 * Safely evaluates simple math expressions like "2 + 3 * 1.5", "10 x 5", "100 : 4", "12,5 + 3,5", "1.000 * 2"
 * Returns the calculated number or null if invalid.
 */
export function evaluateMathExpression(input: string): number | null {
  if (!input || typeof input !== 'string' || !input.trim()) return null;
  
  let sanitized = input.trim();

  // Convert Vietnamese multiply and divide symbols
  sanitized = sanitized
    .replace(/[xX×]/g, '*')
    .replace(/[:÷]/g, '/');

  const preset = getNumberFormatPreset();

  if (preset === 'comma_dot') {
    // US / International Mode: Thousands = comma (,), Decimal = dot (.)
    // Remove thousands commas (commas followed by 3 digits)
    while (/(\d+),(\d{3})/.test(sanitized)) {
      sanitized = sanitized.replace(/(\d+),(\d{3})/g, '$1$2');
    }
    // If there's still a standalone comma e.g. 12,5 (user typed comma decimal by habit)
    sanitized = sanitized.replace(/,/g, '.');
  } else {
    // VN / EU Mode: Thousands = dot (.), Decimal = comma (,)
    while (/(\d+)\.(\d{3})/.test(sanitized)) {
      sanitized = sanitized.replace(/(\d+)\.(\d{3})/g, '$1$2');
    }
    sanitized = sanitized.replace(/,/g, '.');
  }

  // Allow only digits, basic operators (+, -, *, /), parentheses, dots, and whitespace
  if (!/^[0-9+\-*/().\s]+$/.test(sanitized)) {
    return null;
  }

  try {
    // Safely evaluate using Function
    const result = new Function(`return (${sanitized})`)();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }
  } catch (e) {
    // Ignore syntax errors while typing e.g. "10 + "
  }

  return null;
}

/**
 * Checks if a string input contains math calculation expressions.
 */
export function hasMathExpression(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return /[+\-*/xX×:÷]/.test(input);
}

/**
 * Parses numbers accurately supporting Vietnamese/European decimal/thousand formats (e.g. "1.234,5", "110.000", "45,75").
 */
export function parseVietnameseNumber(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;

  const str = String(val).trim();
  if (!str) return 0;

  // First try direct Number(str) - if clean string with no commas or thousand dots
  const direct = Number(str);
  if (!isNaN(direct) && !str.includes(',') && !/\d+\.\d{3}$/.test(str)) {
    return direct;
  }

  // Handle dot and comma combinations
  if (str.includes('.') && str.includes(',')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      // e.g. 1.234,5 -> 1234.5
      const clean = str.replace(/\./g, '').replace(',', '.');
      const num = Number(clean);
      if (!isNaN(num)) return num;
    } else {
      // e.g. 1,234.5 -> 1234.5
      const clean = str.replace(/,/g, '');
      const num = Number(clean);
      if (!isNaN(num)) return num;
    }
  }

  // Handle single dot (e.g. 110.000 or 1.234)
  if (str.includes('.') && !str.includes(',')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
      const clean = str.replace(/\./g, '');
      const num = Number(clean);
      if (!isNaN(num)) return num;
    }
    const num = Number(str);
    if (!isNaN(num)) return num;
  }

  // Handle single comma (e.g. 45,75 or 110,000)
  if (str.includes(',') && !str.includes('.')) {
    if (/^\d{1,3}(,\d{3})+$/.test(str)) {
      const clean = str.replace(/,/g, '');
      const num = Number(clean);
      if (!isNaN(num)) return num;
    }
    const clean = str.replace(',', '.');
    const num = Number(clean);
    if (!isNaN(num)) return num;
  }

  const expr = evaluateMathExpression(str);
  if (expr !== null && !isNaN(expr)) return expr;

  const fallback = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isNaN(fallback) ? 0 : fallback;
}

/**
 * Unified helper for parsing Excel cell numbers reliably.
 */
export const parseExcelNumber = parseVietnameseNumber;


