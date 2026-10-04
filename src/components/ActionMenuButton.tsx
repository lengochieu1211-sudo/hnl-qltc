import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  triggerTone?: 'primary' | 'secondary';
}

type MenuLayout =
  | { mode: 'popover'; left: number; top: number; width: number; maxHeight: number; placement: 'above' | 'below' }
  | { mode: 'sheet'; maxHeight: string };

const entryToneClass: Record<ActionMenuTone, string> = {
  primary: 'text-blue-700 hover:bg-blue-50',
  neutral: 'text-slate-700 hover:bg-slate-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
  danger: 'text-rose-700 hover:bg-rose-50',
};

export const ActionMenuButton: React.FC<ActionMenuButtonProps> = ({
  label, icon: TriggerIcon, entries, menuTitle, footer, disabled = false,
  fillMobile = false, fillWidth = false, align = 'right', ariaLabel,
  triggerTone = 'primary',
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollTopBeforeOpenRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<MenuLayout | null>(null);
  const menuId = React.useId();

  const close = useCallback(() => {
    setOpen(false);
    setLayout(null);
  }, []);

  const positionMenu = useCallback(() => {
    if (!open || typeof window === 'undefined') return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const mobile = viewportWidth < 640;
    const gap = 8;
    const edge = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const naturalHeight = Math.max(1, menu.scrollHeight);
    const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - edge);
    const availableAbove = Math.max(0, triggerRect.top - gap - edge);
    const bestAvailable = Math.max(availableBelow, availableAbove);

    // Frequent 2–3 item menus stay beside the pressed button. A bottom sheet is only
    // a fallback for a longer mobile menu that cannot fit reasonably on either side.
    const useSheet = mobile && naturalHeight > bestAvailable && naturalHeight > 220;
    if (useSheet) {
      setLayout({
        mode: 'sheet',
        maxHeight: 'min(68dvh, calc(100dvh - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)))',
      });
      return;
    }

    const placement: 'above' | 'below' =
      naturalHeight <= availableBelow || availableBelow >= availableAbove ? 'below' : 'above';
    const maxHeight = Math.max(120, placement === 'below' ? availableBelow : availableAbove);
    const width = Math.min(288, viewportWidth - edge * 2);
    const preferredLeft = align === 'right' ? triggerRect.right - width : triggerRect.left;
    const left = Math.min(Math.max(edge, preferredLeft), viewportWidth - width - edge);
    const renderedHeight = Math.min(naturalHeight, maxHeight);
    const top = placement === 'below'
      ? Math.min(viewportHeight - renderedHeight - edge, triggerRect.bottom + gap)
      : Math.max(edge, triggerRect.top - gap - renderedHeight);

    setLayout({ mode: 'popover', left, top, width, maxHeight, placement });
  }, [align, open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const raf = window.requestAnimationFrame(() => {
      positionMenu();
      if (Math.abs(window.scrollY - scrollTopBeforeOpenRef.current) > 1) {
        window.scrollTo({ top: scrollTopBeforeOpenRef.current, behavior: 'auto' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, entries.length, positionMenu]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onViewportChange = () => window.requestAnimationFrame(positionMenu);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  const triggerToneClass = triggerTone === 'secondary'
    ? 'border-slate-200 bg-white text-slate-600 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
    : 'border-blue-600 bg-blue-600 text-white shadow-sm hover:border-blue-700 hover:bg-blue-700';

  const menuContent = open && typeof document !== 'undefined'
    ? createPortal(
        <>
          {layout?.mode === 'sheet' && (
            <button
              type="button"
              aria-label="Đóng menu thao tác"
              className="fixed inset-0 z-[169] bg-slate-950/20 backdrop-blur-[1px] sm:hidden"
              onClick={close}
            />
          )}
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            data-hnl-action-menu="true"
            data-hnl-action-menu-mode={layout?.mode || 'measuring'}
            data-hnl-action-menu-placement={layout?.mode === 'popover' ? layout.placement : 'bottom'}
            className={`fixed z-[170] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ${layout ? 'visible' : 'invisible'}`}
            style={layout?.mode === 'popover'
              ? { left: layout.left, top: layout.top, width: layout.width, maxHeight: layout.maxHeight }
              : layout?.mode === 'sheet'
              ? { left: 8, right: 8, bottom: 'calc(0.5rem + env(safe-area-inset-bottom))', maxHeight: layout.maxHeight }
              : { left: 8, top: 8, width: Math.min(288, typeof window !== 'undefined' ? window.innerWidth - 16 : 288) }}
          >
            {layout?.mode === 'sheet' && <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />}
            {menuTitle && <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{menuTitle}</div>}
            {entries.map((entry, index) => {
              if (entry.type === 'separator') {
                return <div key={`separator-${index}`} className="mt-1 border-t border-slate-100 px-2 pb-1 pt-2 text-[10px] font-black uppercase tracking-wider text-slate-400">{entry.label}</div>;
              }
              const Icon = entry.icon;
              const commonClass = `flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${entryToneClass[entry.tone || 'neutral']} ${entry.disabled ? 'pointer-events-none opacity-45' : ''}`;
              if (entry.type === 'file') {
                return (
                  <label key={`${entry.label}-${index}`} role="menuitem" className={`${commonClass} cursor-pointer`}>
                    {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span>{entry.label}</span>
                    <input
                      type="file"
                      accept={entry.accept}
                      className="hidden"
                      disabled={entry.disabled}
                      onChange={(event) => {
                        close();
                        entry.onChange(event);
                      }}
                    />
                  </label>
                );
              }
              return (
                <button
                  key={`${entry.label}-${index}`}
                  type="button"
                  role="menuitem"
                  disabled={entry.disabled}
                  onClick={() => {
                    close();
                    entry.onSelect();
                  }}
                  className={commonClass}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span>{entry.label}</span>
                </button>
              );
            })}
            {footer && <div className="mt-1 border-t border-slate-100 px-2 pt-2 text-[10px] leading-relaxed text-slate-400">{footer}</div>}
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel || label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-hnl-action-menu-trigger="true"
        onPointerDown={() => {
          if (typeof window !== 'undefined') scrollTopBeforeOpenRef.current = window.scrollY;
        }}
        onClick={() => {
          if (disabled) return;
          setLayout(null);
          setOpen((value) => !value);
        }}
        className={`list-none cursor-pointer select-none whitespace-nowrap rounded-xl border transition active:scale-[0.99] ${triggerToneClass} ${
          fillWidth ? 'flex h-10 w-full items-center justify-center gap-1.5 px-3 text-xs font-extrabold' : fillMobile ? 'flex h-10 w-full items-center justify-center gap-1.5 px-3 text-xs font-extrabold sm:h-9 sm:w-auto' : 'inline-flex h-9 items-center gap-1.5 px-3 text-xs font-extrabold'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <TriggerIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {menuContent}
    </>
  );
};
