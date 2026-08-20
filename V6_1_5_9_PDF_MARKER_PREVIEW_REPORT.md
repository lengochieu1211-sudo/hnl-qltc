# V6.1.5.9 — PDF Marker Preview & Short Defect Code Fix

## Fixed

1. The PDF option **Số ngắn: 01, 02** previously still used a short code derived from the raw Defect ID. This did not match the option label or preview.
2. PDF Defect markers and their legend now use one report sequence: `01`, `02`, ... (or `001` when the report has 100+ defects).
3. The alternate style is now **Mã ngắn: DF-01, DF-02**, not a raw/full Defect ID.
4. The quick preview now illustrates the real semantics:
   - room marker is centered inside the highlighted room;
   - a Defect origin dot stays at the true position;
   - an optional leader line connects the origin dot to the printed label.
5. No project IDs are changed. This is display/export-only behavior.

## Expected result

If `Ký hiệu Defect = Số ngắn`, the PDF map and legend show `01`, `02`, `03` only. Defect category/name/description remains in the legend columns, not inside the map marker.
