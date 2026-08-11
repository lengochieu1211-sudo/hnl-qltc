/**
 * Utility functions for numeric calculations, parsing math expressions,
 * and smart decimal formatting.
 */

/**
 * Formats a number to show at most 3 decimal places.
 * If the number has fewer than 3 decimals, it does not add trailing zeros.
 * Keeps the raw value's high precision intact under the hood.
 */
export function formatDecimal(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0';
  if (Number.isInteger(val)) return val.toString();

  // Format to at most 3 decimal places and remove trailing zeros
  const rounded = Number(val.toFixed(3));
  return rounded.toString();
}

/**
 * Safely evaluates simple math expressions like "2 + 3 * 1.5", "100 / 4", "4.5 * 2"
 * Returns the calculated number or null if invalid.
 */
export function evaluateMathExpression(input: string): number | null {
  if (!input || !input.trim()) return null;

  // Replace Vietnamese comma with decimal point
  let sanitized = input.replace(/,/g, '.');

  // Allow only digits, basic operators (+, -, *, /), parentheses, and whitespace
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
    // Ignore error, return null
  }

  return null;
}
