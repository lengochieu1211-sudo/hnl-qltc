/** Basic room quantity expressions. No dynamic code execution or implicit missing values. */
export type QuantityVariable = 'S' | 'P' | 'L' | 'KL';
export type QuantityVariables = Partial<Record<QuantityVariable, number>>;
export type QuantityFormulaResult = { valid: true; value: number } | { valid: false; reason: string };

/** Only recognized quantity variables create a live link; numeric multiplication x/X is not a variable. */
export function hasLinkedQuantityVariables(input: string): boolean {
  return (input.toUpperCase().match(/[A-Z]+/g) || []).some(token =>
    token === 'S' || token === 'P' || token === 'L' || token === 'KL');
}

export function evaluateRoomQuantityFormula(input: string, variables: QuantityVariables = {}): QuantityFormulaResult {
  const invalid = (reason: string): QuantityFormulaResult => ({ valid: false, reason });
  if (typeof input !== 'string' || !input.trim() || input.length > 256) return invalid('Công thức trống hoặc quá dài.');
  const source = input.toUpperCase().replace(/×/g, '*').replace(/÷/g, '/');
  // One decimal separator per number; thousands separators deliberately unsupported.
  const tokens = source.match(/\s+|(?:\d+(?:[.,]\d+)?|[.,]\d+)|KL|[SPL]|[()+\-*/]/g) || [];
  if (tokens.join('') !== source) return invalid('Công thức chứa ký tự không hợp lệ.');
  const parts = tokens.filter(t => !/^\s+$/.test(t));
  let pos = 0;
  const fail = (message: string): never => { throw new Error(message); };
  const finite = (value: number): number => Number.isFinite(value) ? value : fail('Kết quả không hữu hạn.');
  const factor = (depth: number): number => {
    if (depth > 32) return fail('Công thức lồng nhau quá sâu.');
    const token = parts[pos++];
    if (token === '+' || token === '-') return finite((token === '-' ? -1 : 1) * factor(depth + 1));
    if (token === '(') {
      const value = expression(depth + 1);
      if (parts[pos++] !== ')') return fail('Thiếu dấu đóng ngoặc.');
      return value;
    }
    if (token === 'S' || token === 'P' || token === 'L' || token === 'KL') {
      const value = variables[token];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail('Thiếu nguồn tính hợp lệ: ' + token);
      return value;
    }
    if (token && /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(token)) return finite(Number(token.replace(',', '.')));
    return fail('Thiếu số, biến hoặc biểu thức hợp lệ.');
  };
  const term = (depth: number): number => {
    let value = factor(depth);
    while (parts[pos] === '*' || parts[pos] === '/') {
      const operator = parts[pos++];
      const rhs = factor(depth);
      if (operator === '/' && rhs === 0) return fail('Không được chia cho 0.');
      value = finite(operator === '*' ? value * rhs : value / rhs);
    }
    return value;
  };
  const expression = (depth: number): number => {
    let value = term(depth);
    while (parts[pos] === '+' || parts[pos] === '-') {
      const operator = parts[pos++];
      const rhs = term(depth);
      value = finite(operator === '+' ? value + rhs : value - rhs);
    }
    return value;
  };
  try {
    const value = expression(0);
    if (pos !== parts.length) return invalid('Thiếu phép toán hoặc công thức không hợp lệ.');
    if (value < 0) return invalid('Khối lượng không được âm.');
    return { valid: true, value: value === 0 ? 0 : value };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Công thức không hợp lệ.');
  }
}
