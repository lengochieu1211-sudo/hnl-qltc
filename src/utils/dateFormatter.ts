/**
 * Utility to format Excel dates and general dates into YYYY-MM-DD or DD/MM/YYYY
 */
export function formatExcelDate(excelDate: any): string {
  if (!excelDate) return new Date().toISOString().split('T')[0];
  if (typeof excelDate === 'number') {
    const parsed = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  const dateStr = String(excelDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // 1. If it's already in DD/MM/YYYY, return as is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. Supposing input is in YYYY-MM-DD (e.g. from standard <input type="date">)
  const yyyymmddRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = trimmed.match(yyyymmddRegex);
  if (match) {
    const [_, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  // 3. Fallback: Parse with standard Date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (e) {
    // If parsing fails, just return original string
  }

  return dateStr;
}
