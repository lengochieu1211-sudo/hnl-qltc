from pathlib import Path

path = Path('src/components/GoogleConfigTab.tsx')
text = path.read_text(encoding='utf-8')

old = '''      {/* APP FORMATTING PREFERENCES CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">
        <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-indigo-600" /> {t('formatting_settings')}
          </span>
          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold">
            {t('formatting_subtitle')}
          </span>
        </h3>
'''
new = '''      {/* APP FORMATTING PREFERENCES CARD */}
      <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3.5 select-none">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Sliders className="w-4 h-4 text-indigo-600" /> {t('formatting_settings')}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Nhấn để mở / thu gọn cài đặt định dạng hiển thị.</div>
          </div>
          <span className="shrink-0 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">
            {numberFormatPreset === 'dot_comma' ? '1.234,56' : '1,234.56'} · {dateFormatPreset}
          </span>
        </summary>
        <div className="space-y-3.5 px-4 pb-4">
'''
if old not in text:
    raise SystemExit('format header anchor not found')
text = text.replace(old, new, 1)

old = '''        </div>
      </div>


      {/* IMAGE QUALITY & STORAGE CARD */}
'''
new = '''        </div>
        </div>
      </details>

      {/* IMAGE QUALITY & STORAGE CARD */}
'''
if old not in text:
    raise SystemExit('format close anchor not found')
text = text.replace(old, new, 1)

old = '''      {/* IMAGE QUALITY & STORAGE CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">
        <div className="border-b border-slate-100 pb-2">
          <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
            <Sliders className="w-4 h-4 text-indigo-600" /> Chất lượng ảnh & dung lượng
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">Mặt bằng ưu tiên độ nét chữ; Defect ưu tiên chi tiết lỗi; Quân số ưu tiên cân bằng tốc độ đồng bộ. Thiết lập lưu trên thiết bị này.</p>
        </div>
'''
new = '''      {/* IMAGE QUALITY & STORAGE CARD */}
      <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3.5 select-none">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Sliders className="w-4 h-4 text-indigo-600" /> Chất lượng ảnh & dung lượng
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Nhấn để mở / thu gọn chất lượng Mặt bằng, Defect và Quân số.</div>
          </div>
          <span className="shrink-0 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">
            {getImageQualityProfile('floorPlan', imageQualitySettings.floorPlan).label}
          </span>
        </summary>
        <div className="space-y-3.5 px-4 pb-4">
          <p className="text-[10px] text-slate-500">Mặt bằng ưu tiên độ nét chữ; Defect ưu tiên chi tiết lỗi; Quân số ưu tiên cân bằng tốc độ đồng bộ. Thiết lập lưu trên thiết bị này.</p>
'''
if old not in text:
    raise SystemExit('image header anchor not found')
text = text.replace(old, new, 1)

old = '''        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">Lưu ý: “Gốc/Rất cao” làm file lớn và đồng bộ chậm hơn. Với điện thoại nên giữ Mặt bằng = Tự động, Defect = Tiêu chuẩn, Quân số = Tiêu chuẩn.</p>
      </div>



      {/* LIGHTWEIGHT TRASH / RECOVERY CARD */}
'''
new = '''        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">Lưu ý: “Gốc/Rất cao” làm file lớn và đồng bộ chậm hơn. Với điện thoại nên giữ Mặt bằng = Tự động, Defect = Tiêu chuẩn, Quân số = Tiêu chuẩn.</p>
        </div>
      </details>

      {/* LIGHTWEIGHT TRASH / RECOVERY CARD */}
'''
if old not in text:
    raise SystemExit('image close anchor not found')
text = text.replace(old, new, 1)

old = '''      {/* LIGHTWEIGHT TRASH / RECOVERY CARD */}
      <div id="trash-recovery-card" className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5 scroll-mt-24 transition-shadow">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <Trash2 className="w-4 h-4 text-rose-600" /> Dữ liệu đã ẩn & lịch sử
            </h3>
            <p className="text-[10px] text-slate-500 mt-1">
              Chỉ lưu metadata cần khôi phục, không nhân đôi Base64/blob/ảnh nhị phân. Mặc định giữ 7 ngày.
            </p>
            <p className="text-[10px] text-amber-700 mt-1">
              Phiếu nhập/xuất kho là lịch sử giao dịch: nếu xóa nhầm hãy ưu tiên Khôi phục rồi Hủy/Điều chỉnh trong Kho; chỉ xóa vĩnh viễn khi chắc chắn không cần đối chiếu.
            </p>
          </div>
          <span className={`text-[10px] font-bold rounded-lg px-2 py-1 border shrink-0 ${trashSettings.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
            {trashSettings.enabled ? 'Đang bật' : 'Đang tắt'}
          </span>
        </div>
'''
new = '''      {/* LIGHTWEIGHT TRASH / RECOVERY CARD */}
      <details id="trash-recovery-card" className="group rounded-2xl border border-slate-200 bg-white shadow-sm scroll-mt-24 transition-shadow">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3.5 select-none">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Trash2 className="w-4 h-4 text-rose-600" /> Dữ liệu đã ẩn & lịch sử
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Nhấn để mở / thu gọn thùng rác, khôi phục và lịch sử xóa.</div>
          </div>
          <span className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold ${trashSettings.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
            {trashOperations.length} mục · {trashSettings.enabled ? 'Đang bật' : 'Đang tắt'}
          </span>
        </summary>
        <div className="space-y-3.5 px-4 pb-4">
          <div>
            <p className="text-[10px] text-slate-500">
              Chỉ lưu metadata cần khôi phục, không nhân đôi Base64/blob/ảnh nhị phân. Mặc định giữ 7 ngày.
            </p>
            <p className="text-[10px] text-amber-700 mt-1">
              Phiếu nhập/xuất kho là lịch sử giao dịch: nếu xóa nhầm hãy ưu tiên Khôi phục rồi Hủy/Điều chỉnh trong Kho; chỉ xóa vĩnh viễn khi chắc chắn không cần đối chiếu.
            </p>
          </div>
'''
if old not in text:
    raise SystemExit('trash header anchor not found')
text = text.replace(old, new, 1)

old = '''        {userRole !== 'ADMIN' && (
          <p className="text-[10px] text-slate-500">Chỉ ADMIN được đổi thời gian lưu, khôi phục hoặc xóa vĩnh viễn.</p>
        )}
      </div>

    </div>
'''
new = '''        {userRole !== 'ADMIN' && (
          <p className="text-[10px] text-slate-500">Chỉ ADMIN được đổi thời gian lưu, khôi phục hoặc xóa vĩnh viễn.</p>
        )}
        </div>
      </details>

    </div>
'''
if old not in text:
    raise SystemExit('trash close anchor not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Patched GoogleConfigTab collapsible sections successfully')
