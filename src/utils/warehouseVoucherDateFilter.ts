/** Read-only calendar-date matching for warehouse vouchers (no timezone conversion). */
export function warehouseVoucherIsoDate(dateValue: string | null | undefined): string {
  const raw = String(dateValue ?? '').trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(raw);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (!iso && !local) return '';
  const year = Number(iso ? iso[1] : local![3]);
  const month = Number(iso ? iso[2] : local![2]);
  const day = Number(iso ? iso[3] : local![1]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Supports DD/MM/YYYY, DD-MM-YYYY, MM/YYYY, YYYY and ISO YYYY-MM-DD. */
export function matchesWarehouseVoucherDate(dateValue: string | null | undefined, searchText: string): boolean {
  const query = searchText.trim().toLocaleLowerCase('vi-VN');
  if (!query) return true;
  const iso = warehouseVoucherIsoDate(dateValue);
  if (!iso) return false;
  const [year, month, day] = iso.split('-');
  const variants = [
    iso, `${day}/${month}/${year}`, `${day}-${month}-${year}`,
    `${Number(day)}/${Number(month)}/${year}`,
    `${month}/${year}`, `${Number(month)}/${year}`,
  ];
  return variants.some((value) => value.includes(query));
}

/** Compare calendar dates inclusively; unparseable dates never enter a selected range. */
export function isWarehouseVoucherDateInRange(
  dateValue: string | null | undefined,
  fromDate: string,
  toDate: string,
): boolean {
  if (!fromDate && !toDate) return true;
  if (fromDate && toDate && fromDate > toDate) return false;
  const iso = warehouseVoucherIsoDate(dateValue);
  return Boolean(iso) && (!fromDate || iso >= fromDate) && (!toDate || iso <= toDate);
}
