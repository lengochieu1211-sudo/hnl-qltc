import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, BrainCircuit, Database, FileSearch, Loader2, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
import type { ChecklistItem, CrewRecord, DefectItem, FloorPlan, InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../../types';
import type { UserRole } from '../../utils/securityUtils';
import { createHnlAiProjectSnapshot } from '../../ai/data/projectSnapshot';
import { runHnlAiQuestion, type HnlAiOrchestratorResult } from '../../ai/orchestrator/aiOrchestrator';
import { HnlManagedAiProvider } from '../../ai/providers/hnlManagedProvider';
import type { AiProviderModelInfo } from '../../ai/providers/providerTypes';
import type { AiAuditSummary } from '../../ai/core/contracts';

export type AiAssistantMode = 'data' | 'audit' | 'ai' | 'hybrid';

export interface AiAssistantPageProps {
  projectId: string;
  projectName: string;
  role: UserRole;
  accessVerified: boolean;
  online: boolean;
  rooms: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  teams: TeamInfo[];
  floors: FloorPlan[];
  workVolumes: WorkVolume[];
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  checklist: ChecklistItem[];
}

const MODE_META: Record<AiAssistantMode, { label: string; icon: React.ElementType; hint: string }> = {
  data: { label: 'HNL Data', icon: Database, hint: 'Số liệu deterministic từ dữ liệu dự án.' },
  audit: { label: 'Audit', icon: FileSearch, hint: 'Rule Engine kiểm tra logic và liên kết.' },
  ai: { label: 'AI chung', icon: Bot, hint: 'Kiến thức AI bên ngoài, không gửi dữ liệu HNL.' },
  hybrid: { label: 'HNL + AI', icon: BrainCircuit, hint: 'Engine tính trước, AI chỉ diễn giải.' },
};

const QUICK_PROMPTS: Record<AiAssistantMode, string[]> = {
  data: ['Đội Nguyên đang làm gì hiện tại?', 'Tổng hợp đội Nguyên tuần này'],
  audit: ['Audit toàn dự án', 'Kiểm tra toàn bộ Defect', 'Kiểm tra quân số bất thường', 'Kiểm tra khối lượng'],
  ai: ['Biện pháp thi công trần thạch cao chống cháy', 'Viết email nhắc tổng thầu xử lý tồn tại'],
  hybrid: ['Dựa trên dữ liệu hiện tại, phân tích Defect và đề xuất ưu tiên', 'Kiểm tra toàn dự án và giải thích các rủi ro chính'],
};

function canonicalToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isAuditSummary(value: unknown): value is AiAuditSummary {
  const candidate = value as AiAuditSummary | null;
  return Boolean(candidate && Array.isArray(candidate.issues) && typeof candidate.errorCount === 'number');
}

export const AiAssistantPage: React.FC<AiAssistantPageProps> = (props) => {
  const [mode, setMode] = useState<AiAssistantMode>('data');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HnlAiOrchestratorResult | null>(null);
  const [generalText, setGeneralText] = useState('');
  const [error, setError] = useState('');
  const [models, setModels] = useState<AiProviderModelInfo[]>([]);
  const [model, setModel] = useState('');
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const gatewayUrl = String((import.meta as any).env?.VITE_HNL_AI_GATEWAY_URL || '').trim();

  const provider = useMemo(() => {
    if (!gatewayUrl || !props.projectId) return null;
    try {
      return new HnlManagedAiProvider({ gatewayUrl, provider: 'cloudflare', projectId: props.projectId, role: props.role });
    } catch {
      return null;
    }
  }, [gatewayUrl, props.projectId, props.role]);

  const snapshot = useMemo(() => createHnlAiProjectSnapshot({
    projectId: props.projectId,
    projectName: props.projectName,
    rooms: props.rooms,
    defects: props.defects,
    crewRecords: props.crewRecords,
    teams: props.teams,
    floors: props.floors,
    workVolumes: props.workVolumes,
    inventory: props.inventory,
    materialNorms: props.materialNorms,
    checklist: props.checklist,
    asOf: Date.now(),
    freshness: props.online ? 'live' : 'cache',
  }), [props.projectId, props.projectName, props.rooms, props.defects, props.crewRecords, props.teams, props.floors, props.workVolumes, props.inventory, props.materialNorms, props.checklist, props.online]);

  useEffect(() => {
    let cancelled = false;
    if (!provider || !props.online || !props.accessVerified) {
      setModels([]);
      setModel('');
      return;
    }
    provider.listModels().then((items) => {
      if (cancelled) return;
      setModels(items);
      setModel((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id || ''));
    }).catch(() => {
      if (!cancelled) { setModels([]); setModel(''); }
    });
    return () => { cancelled = true; };
  }, [provider, props.online, props.accessVerified]);

  const runQuestion = async (input?: string) => {
    const text = String(input ?? question).trim();
    if (!text || busy) return;
    setQuestion(text);
    setBusy(true);
    setError('');
    setResult(null);
    setGeneralText('');
    try {
      if (!props.accessVerified) throw new Error('Quyền truy cập dự án chưa được xác minh.');
      if (mode === 'ai') {
        if (!props.online) throw new Error('AI Cloud đang offline. Chế độ AI chung cần có mạng.');
        if (!provider || !model) throw new Error('HNL Managed AI chưa sẵn sàng.');
        const response = await provider.chat({
          mode: 'GENERAL_AI', model,
          messages: [
            { role: 'system', content: 'Bạn là HNL AI Assistant. Trả lời ngắn gọn, chuyên nghiệp. Không giả định hoặc tuyên bố đang đọc dữ liệu dự án HNL trong chế độ AI chung.' },
            { role: 'user', content: text },
          ],
        });
        setGeneralText(response.text || 'AI không trả nội dung.');
        return;
      }

      const runtime = {
        context: { projectId: props.projectId, role: props.role, accessVerified: props.accessVerified, timeZone },
        snapshot,
      };
      const orchestrated = await runHnlAiQuestion({
        question: text,
        runtime,
        referenceDate: canonicalToday(timeZone),
        provider: mode === 'hybrid' ? (provider || undefined) : undefined,
        model: mode === 'hybrid' ? (model || undefined) : undefined,
        requestNarrative: mode === 'hybrid',
        cloudAvailable: props.online,
      });
      setResult(orchestrated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toolResult = result?.toolResult;
  const audit = toolResult && isAuditSummary(toolResult.data) ? toolResult.data : null;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-5 pb-28 space-y-4">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0"><Sparkles className="w-6 h-6" /></div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">HNL AI Assistant</h2>
              <p className="text-xs text-slate-600 truncate">{props.projectName} · {props.role} · {timeZone}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
            {props.online ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
            {props.online ? 'Online' : 'Offline cache'}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {(Object.keys(MODE_META) as AiAssistantMode[]).map((key) => {
            const item = MODE_META[key]; const Icon = item.icon; const active = mode === key;
            return <button key={key} onClick={() => { setMode(key); setResult(null); setGeneralText(''); setError(''); }} className={`rounded-xl px-2 py-2 text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 ${active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}><Icon className="w-4 h-4" />{item.label}</button>;
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{MODE_META[mode].hint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_PROMPTS[mode].map((prompt) => <button key={prompt} onClick={() => void runQuestion(prompt)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">{prompt}</button>)}
        </div>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="Hỏi HNL AI..." className="w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-500">{mode === 'data' || mode === 'audit' ? 'Không cần AI Cloud' : model ? `HNL Managed AI · ${model}` : 'AI Cloud chưa sẵn sàng'}</div>
          <button disabled={busy || !question.trim()} onClick={() => void runQuestion()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Gửi</button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
      {!props.online && mode !== 'ai' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">AI Cloud đang offline. HNL Data/Audit vẫn chạy từ dữ liệu Firestore cache đã có trên thiết bị.</div>}

      {generalText && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-black text-indigo-700 mb-2">AI</div><div className="whitespace-pre-wrap text-sm text-slate-800">{generalText}</div></section>}

      {result && !toolResult && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="font-bold text-amber-900">{result.plan.status === 'needs-clarification' ? 'Cần bổ sung thông tin' : 'Chưa hỗ trợ câu hỏi này'}</div>{result.plan.clarifications.map((item) => <p key={item} className="text-sm mt-1 text-amber-800">{item}</p>)}{result.warnings.map((item) => <p key={item} className="text-xs mt-1 text-amber-700">{item}</p>)}</section>}

      {toolResult && <>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3"><h3 className="font-black text-slate-900">Kết quả HNL</h3><span className="text-[10px] rounded-full bg-emerald-50 text-emerald-700 px-2 py-1 font-bold">{toolResult.metadata.freshness.toUpperCase()}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {toolResult.facts.map((fact) => <div key={fact.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-bold text-slate-500">{fact.kind}</div><div className="text-xs text-slate-600 mt-1">{fact.label}</div><div className="text-lg font-black text-slate-900">{String(fact.value ?? '—')} {fact.unit || ''}</div></div>)}
          </div>
        </section>

        {audit && audit.issues.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="font-black text-slate-900 mb-2">Vấn đề phát hiện</h3><div className="space-y-2 max-h-[420px] overflow-auto">{audit.issues.slice(0, 100).map((issue, index) => <div key={`${issue.ruleId}-${issue.entityId}-${index}`} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2"><span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${issue.severity === 'ERROR' ? 'bg-rose-100 text-rose-700' : issue.severity === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{issue.severity}</span><span className="text-[10px] font-mono text-slate-500">{issue.ruleId}</span></div><p className="mt-1 text-sm text-slate-800">{issue.message}</p></div>)}</div></section>}

        {result.narrative?.statements?.length ? <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><h3 className="font-black text-indigo-900 mb-2">AI nhận xét</h3>{result.narrative.statements.map((statement, index) => <div key={index} className="mb-2 last:mb-0"><div className="text-[10px] font-black text-indigo-600">{statement.kind}</div><p className="text-sm text-indigo-950">{statement.text}</p></div>)}</section> : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm"><h3 className="font-black text-slate-800 mb-2">Nguồn dữ liệu</h3><div>Tool: {toolResult.metadata.tool}</div><div>Records: {toolResult.metadata.recordsUsed}/{toolResult.metadata.recordsScanned}</div><div>Collections: {toolResult.metadata.sourceCollections.join(', ')}</div><div>Evidence: {toolResult.evidence.length} record</div><div>As of: {new Date(toolResult.metadata.asOf).toLocaleString()}</div>{result.warnings.map((warning) => <div key={warning} className="mt-1 text-amber-700">⚠ {warning}</div>)}</section>
      </>}

      <div className="text-center text-[10px] text-slate-400">HNL AI READ + ANALYZE ONLY · Không có quyền tự sửa/xóa dữ liệu</div>
    </div>
  );
};

export default AiAssistantPage;
