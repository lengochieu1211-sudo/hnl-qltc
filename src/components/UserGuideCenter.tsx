import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, Image as ImageIcon, Info, Monitor, Search, ShieldAlert, Smartphone } from 'lucide-react';
import { getGuideTopicCount, guideGroups, type GuideTopic } from './UserGuideContent';

type GuideDevice = 'pc' | 'mobile';

const normalizeSearch = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLocaleLowerCase('vi-VN');

const GuideIllustration: React.FC<{ topic: GuideTopic; entry: string; device: GuideDevice }> = ({ topic, entry, device }) => {
  const actualImage = device === 'pc' ? topic.desktopImage : topic.mobileImage;
  const [imageError, setImageError] = useState(false);
  const hasGolden = Boolean(actualImage && !imageError);
  return (
    <figure className="mb-4 space-y-2" data-hnl-guide-illustration={hasGolden ? 'golden-screenshot' : 'diagram'}>
      {hasGolden ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-2 sm:p-3">
          <img
            src={actualImage}
            alt={`Ảnh chụp kiểm thử giao diện ${device === 'pc' ? 'PC' : 'điện thoại'} liên quan đến ${topic.title}`}
            loading="lazy"
            onError={() => setImageError(true)}
            className="mx-auto max-h-[420px] w-full rounded-xl object-contain object-top"
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4" aria-label={`Sơ đồ thao tác ${topic.title}`}>
          <div className={`mx-auto overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm ${device === 'pc' ? 'max-w-2xl' : 'max-w-[250px]'}`}>
            <div className="flex items-center justify-between bg-slate-800 px-3 py-2 text-xs font-semibold text-white">
              <span>HNL QLTC</span><span>{device === 'pc' ? 'PC / Web / EXE' : 'Điện thoại / Web / APK'}</span>
            </div>
            <div className={`flex gap-2 p-3 ${device === 'pc' ? 'sm:flex-row' : 'flex-col'}`}>
              <div className={`rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-xs font-bold text-indigo-800 ${device === 'pc' ? 'sm:w-1/3' : ''}`}>
                <span className="mb-1 block text-xs uppercase text-indigo-500">1. Mở đúng chức năng</span>
                {entry}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="rounded-lg border border-slate-200 p-2 text-xs font-bold text-slate-700">{topic.title}</div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">2. Kiểm tra dữ liệu</div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">3. Thực hiện thao tác</div>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">4. Kiểm tra kết quả</div>
              </div>
            </div>
          </div>
        </div>
      )}
      <figcaption className="flex items-start gap-1.5 text-xs leading-4 text-slate-500">
        <ImageIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {hasGolden ? 'Ảnh giao diện kiểm thử DEV Golden #784 (24/10/2026), mang tính tham khảo; vị trí nút có thể thay đổi theo tài khoản/quyền/độ rộng màn hình.' : 'Sơ đồ minh họa thao tác, không phải ảnh chụp ứng dụng. Mục này còn thiếu ảnh màn hình kiểm thử riêng.'}
      </figcaption>
    </figure>
  );
};

/**
 * Static/read-only help surface; no Firebase/R2 requests and no app-data writes.
 * Its host is the existing SettingsAccordionCard/SettingsFeatureSheet.
 */
export const UserGuideCenter: React.FC = () => {
  const [device, setDevice] = useState<GuideDevice>('pc');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('login');
  const [allGroupsOpen, setAllGroupsOpen] = useState(false);
  const filteredGroups = useMemo(() => {
    const search = normalizeSearch(query.trim());
    if (!search) return guideGroups;
    return guideGroups.map((group) => ({
      ...group,
      topics: group.topics.filter((topic) => normalizeSearch([
        group.title, group.summary, topic.title, topic.summary, topic.steps.join(' '),
      ].join(' ')).includes(search)),
    })).filter((group) => group.topics.length > 0);
  }, [query]);
  const displayedTopics = filteredGroups.flatMap((group) => group.topics);
  const selectedTopic = displayedTopics.find((topic) => topic.id === selectedId) || displayedTopics[0];
  const selectedGroup = filteredGroups.find((group) => group.topics.some((topic) => topic.id === selectedTopic?.id));
  const entry = device === 'pc' ? selectedGroup?.desktopEntry : selectedGroup?.mobileEntry;
  const pictureCount = guideGroups.reduce((count, group) => count + group.topics.filter((topic) => topic.desktopImage || topic.mobileImage).length, 0);

  return (
    <div className="space-y-4 text-xs text-slate-700" data-hnl-user-guide="true">
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-slate-900 sm:text-sm">Sổ tay sử dụng HNL QLTC</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">{guideGroups.length} nhóm · {getGuideTopicCount()} chủ đề · {pictureCount} chủ đề có ảnh Golden liên quan. Xem được offline khi ứng dụng đã tải trang hướng dẫn; nội dung chỉ đọc, không thay đổi dữ liệu.</p>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white/95 pb-3 pt-1 backdrop-blur" data-hnl-user-guide-controls="true">
        <div className="relative w-full lg:max-w-[560px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm: Defect, kho, nhập phiếu, sao lưu, phân quyền..."
            aria-label="Tìm trong hướng dẫn sử dụng"
            data-hnl-guide-search="true"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:justify-start" role="group" aria-label="Chọn nền tảng hướng dẫn">
          <button type="button" onClick={() => setDevice('pc')} aria-pressed={device === 'pc'} data-hnl-guide-platform="pc" className={`flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold lg:w-auto lg:min-w-[132px] lg:max-w-[180px] lg:flex-none ${device === 'pc' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            <Monitor className="h-4 w-4" aria-hidden="true" /> Máy tính (PC)
          </button>
          <button type="button" onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'} data-hnl-guide-platform="mobile" className={`flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold lg:w-auto lg:min-w-[132px] lg:max-w-[180px] lg:flex-none ${device === 'mobile' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            <Smartphone className="h-4 w-4" aria-hidden="true" /> Điện thoại
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(225px,280px)_minmax(0,1fr)]">
        <nav className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:p-3" aria-label="Mục lục hướng dẫn" data-hnl-guide-toc="true">
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <h4 className="font-bold text-slate-800">Mục lục ({displayedTopics.length})</h4>
            <button type="button" onClick={() => setAllGroupsOpen((open) => !open)} className="text-xs font-bold text-indigo-700 underline underline-offset-2">{allGroupsOpen ? 'Thu gọn' : 'Mở tất cả'}</button>
          </div>
          {filteredGroups.map((group) => (
            <details key={group.id} open={Boolean(query) || allGroupsOpen || selectedGroup?.id === group.id} className="group rounded-xl border border-slate-200 bg-white" data-hnl-guide-group={group.id}>
              <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-slate-800 marker:text-indigo-500">{group.title} <span className="font-normal text-slate-500">({group.topics.length})</span></summary>
              <div className="space-y-0.5 border-t border-slate-100 px-1 py-1">
                {group.topics.map((topic) => (
                  <button
                    type="button"
                    key={topic.id}
                    onClick={() => setSelectedId(topic.id)}
                    aria-current={selectedTopic?.id === topic.id ? 'page' : undefined}
                    data-hnl-guide-topic={topic.id}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs leading-4 ${selectedTopic?.id === topic.id ? 'bg-indigo-50 font-bold text-indigo-700 ring-1 ring-indigo-100' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    <span>{topic.title}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </details>
          ))}
          {displayedTopics.length === 0 && <p className="p-3 text-slate-500">Không có chủ đề khớp từ khóa. Thử tên chức năng khác.</p>}
        </nav>

        {selectedTopic && selectedGroup && entry ? (
          <article key={selectedTopic.id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5" data-hnl-guide-current-topic={selectedTopic.id}>
            <div className="space-y-1 border-b border-slate-100 pb-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-indigo-600">{selectedGroup.title} · {device === 'pc' ? 'Hướng dẫn PC' : 'Hướng dẫn điện thoại'}</p>
              <h3 className="text-sm font-extrabold leading-5 text-slate-900">{selectedTopic.title}</h3>
              <p className="text-xs leading-5 text-slate-600">{selectedTopic.summary}</p>
            </div>

            <GuideIllustration key={`${selectedTopic.id}-${device}`} topic={selectedTopic} entry={entry} device={device} />

            <h4 className="font-bold text-slate-900">Các bước thực hiện</h4>
            <ol className="space-y-3" data-hnl-guide-steps={device}>
              {[entry,...selectedTopic.steps].map((step, index) => (
                <li key={index} className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-700">{index + 1}</span>
                  <p className="min-w-0 pt-0.5 text-xs leading-5 text-slate-700">{step}</p>
                </li>
              ))}
            </ol>
            {device === 'mobile' && selectedTopic.mobileNote && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><Info className="mr-1 inline h-4 w-4" aria-hidden="true" /> <strong>Riêng trên điện thoại:</strong> {selectedTopic.mobileNote}</div>
            )}
            {selectedTopic.example && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5"><strong>Ví dụ thực tế:</strong> {selectedTopic.example}</div>}
            {selectedTopic.caution && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950" role="note">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span><strong>Lưu ý an toàn:</strong> {selectedTopic.caution}</span>
              </div>
            )}
            <p className="border-t border-slate-100 pt-3 text-xs leading-4 text-slate-500">Hướng dẫn biên soạn theo source DEV 21420a955. Chức năng được hiển thị còn phụ thuộc quyền tài khoản và cấu hình ứng dụng; hướng dẫn không tự thực hiện thao tác.</p>
          </article>
        ) : null}
      </div>
    </div>
  );
};
