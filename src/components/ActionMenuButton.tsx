import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

export type ActionMenuTone = 'primary' | 'neutral' | 'success' | 'danger';
export type ActionMenuEntry =
  | { type?: 'button'; label: string; icon?: LucideIcon; onSelect: () => void; tone?: ActionMenuTone; disabled?: boolean }
  | { type: 'file'; label: string; icon?: LucideIcon; accept: string; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void; tone?: ActionMenuTone; disabled?: boolean }
  | { type: 'separator'; label?: string };

interface ActionMenuButtonProps {
  label: string;
  icon: LucideIcon;
  entries: ActionMenuEntry[];
  menuTitle?: string;
  footer?: string;
  disabled?: boolean;
  fillMobile?: boolean;
  fillWidth?: boolean;
  align?: 'left' | 'right';
  ariaLabel?: string;
}

const entryToneClass: Record<ActionMenuTone, string> = {
  primary: 'text-blue-700 hover:bg-blue-50',
  neutral: 'text-slate-700 hover:bg-slate-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
  danger: 'text-rose-700 hover:bg-rose-50',
};

export const ActionMenuButton: React.FC<ActionMenuButtonProps> = ({
  label, icon: TriggerIcon, entries, menuTitle, footer, disabled = false,
  fillMobile = false, fillWidth = false, align = 'right', ariaLabel,
}) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');
  return (
    <details ref={detailsRef} className={`group relative shrink-0 ${fillWidth ? 'w-full' : fillMobile ? 'w-full sm:w-auto' : ''}`}>
      <summary
        aria-label={ariaLabel || label}
        className={`list-none cursor-pointer select-none whitespace-nowrap rounded-xl border border-blue-600 bg-blue-600 text-white shadow-sm transition hover:border-blue-700 hover:bg-blue-700 active:scale-[0.99] [&::-webkit-details-marker]:hidden ${fillWidth ? 'flex h-10 w-full items-center justify-center gap-1.5 px-3 text-xs font-extrabold' : fillMobile ? 'flex h-10 w-full items-center justify-center gap-1.5 px-3 text-xs font-extrabold sm:w-auto sm:h-9' : 'inline-flex h-9 items-center gap-1.5 px-3 text-xs font-extrabold'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <TriggerIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={`fixed bottom-2 left-2 right-2 z-[170] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl sm:absolute sm:bottom-auto sm:top-[calc(100%+6px)] sm:left-auto sm:w-72 ${align === 'left' ? 'sm:left-0 sm:right-auto' : 'sm:right-0'}`}>
        {menuTitle && <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{menuTitle}</div>}
        {entries.map((entry, index) => {
          if (entry.type === 'separator') return <div key={`separator-${index}`} className="mt-1 border-t border-slate-100 px-2 pb-1 pt-2 text-[10px] font-black uppercase tracking-wider text-slate-400">{entry.label}</div>;
          const Icon = entry.icon;
          const commonClass = `flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${entryToneClass[entry.tone || 'neutral']} ${entry.disabled ? 'pointer-events-none opacity-45' : ''}`;
          if (entry.type === 'file') return (
            <label key={`${entry.label}-${index}`} className={`${commonClass} cursor-pointer`}>
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}<span>{entry.label}</span>
              <input type="file" accept={entry.accept} className="hidden" disabled={entry.disabled} onClick={() => close()} onChange={entry.onChange} />
            </label>
          );
          return (
            <button key={`${entry.label}-${index}`} type="button" disabled={entry.disabled} onClick={() => { close(); entry.onSelect(); }} className={commonClass}>
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}<span>{entry.label}</span>
            </button>
          );
        })}
        {footer && <div className="mt-1 border-t border-slate-100 px-2 pt-2 text-[10px] leading-relaxed text-slate-400">{footer}</div>}
      </div>
    </details>
  );
};
