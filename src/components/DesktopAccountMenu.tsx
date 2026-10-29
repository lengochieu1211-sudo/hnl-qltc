import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, LockKeyhole, LogOut, Settings, ShieldCheck, UserRound, WifiOff, X } from 'lucide-react';
import type { GoogleAuthStatus } from '../types';
import { getFirebaseAuthStatus, subscribeToFirebaseAuthStatus } from '../lib/firebase';

interface DesktopAccountMenuProps {
  userRole: string;
  roleResolved: boolean;
  online: boolean;
  hasPendingSync: boolean;
  onOpenSecurity: (section: 'account' | 'switch' | 'rbac') => void;
  onLockNow: () => void;
  onSignOut: () => Promise<void>;
}

/**
 * Desktop presentation only. Reuses the existing Firebase Auth subscription and
 * existing Security Center/PIN/sign-out handlers. No Firestore reads or writes.
 */
export const DesktopAccountMenu: React.FC<DesktopAccountMenuProps> = ({
  userRole, roleResolved, online, hasPendingSync, onOpenSecurity, onLockNow, onSignOut,
}) => {
  const [auth, setAuth] = useState<GoogleAuthStatus>(() => getFirebaseAuthStatus());
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeToFirebaseAuthStatus(setAuth), []);
  useEffect(() => { setImageFailed(false); }, [auth.picture]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  useEffect(() => { if (!auth.authenticated) setOpen(false); }, [auth.authenticated]);

  const name = auth.name?.trim() || auth.email?.split('@')[0] || 'Tài khoản Google';
  const roleLabel = !roleResolved ? 'Đang xác minh quyền'
    : userRole === 'ADMIN' ? 'Quản trị viên'
    : userRole === 'EDITOR' ? 'Kỹ sư'
    : 'Chỉ xem';
  const avatar = auth.picture && !imageFailed
    ? <img src={auth.picture} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-full w-full rounded-full object-cover" />
    : <span className="text-sm font-extrabold text-indigo-700">{name.charAt(0).toLocaleUpperCase('vi-VN')}</span>;
  const launch = (action: () => void) => { setOpen(false); action(); };

  return (
    <div ref={menuRef} className="relative flex shrink-0 flex-col items-center border-b border-slate-200 px-1.5 pb-2 pt-2" data-hnl-desktop-account-menu="true">
      <button
        type="button"
        aria-label="Mở menu tài khoản Google"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={`group flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1.5 outline-none transition hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 ${open ? 'bg-indigo-50' : ''}`}
        title={auth.email || 'Tài khoản Google'}
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-indigo-400 bg-indigo-100 shadow-sm">
          {avatar}
          <span className="sr-only">{auth.authenticated ? 'Đã đăng nhập' : 'Chưa đăng nhập'}</span>
        </span>
        <span className="flex max-w-full items-center gap-0.5 text-[9px] font-bold leading-3 text-slate-600">
          <span className="truncate">Tài khoản</span><ChevronDown className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Thông tin và thao tác tài khoản"
          className="fixed left-[90px] top-2 z-[100] w-[min(315px,calc(100vw-100px))] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-2xl"
        >
          <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-2.5 py-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-indigo-200 bg-indigo-100">
              {auth.picture && !imageFailed
                ? <img src={auth.picture} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
                : <span className="text-lg font-bold text-indigo-700">{name.charAt(0).toLocaleUpperCase('vi-VN')}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-slate-900">{name}</p>
              <p className="truncate text-[11px] text-slate-600" title={auth.email || ''}>{auth.email || 'Chưa có email'}</p>
              <p className="mt-1 text-[10px] font-bold text-indigo-700"><ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />{roleLabel}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-200" aria-label="Đóng menu tài khoản"><X className="h-4 w-4" /></button>
          </div>
          {(!online || hasPendingSync) && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-900" role="status">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {hasPendingSync ? 'Còn dữ liệu chờ đồng bộ. Không đăng xuất cho tới khi đồng bộ hoàn tất.' : 'Đang ngoại tuyến. Kết nối mạng trước khi đăng xuất.'}
            </p>
          )}
          <div className="my-2 border-t border-slate-100" />
          <button type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => launch(() => onOpenSecurity('account'))}>
            <UserRound className="h-4 w-4 text-indigo-600" /> Thông tin tài khoản
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => launch(() => onOpenSecurity('switch'))}>
            <Settings className="h-4 w-4 text-indigo-600" /> Đăng nhập / Đổi tài khoản
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => launch(() => onOpenSecurity('rbac'))}>
            <ShieldCheck className="h-4 w-4 text-indigo-600" /> Bảo mật & phân quyền
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => launch(onLockNow)}>
            <LockKeyhole className="h-4 w-4 text-amber-600" /> Khóa ứng dụng
          </button>
          <div className="my-2 border-t border-slate-100" />
          <button
            type="button"
            role="menuitem"
            disabled={!auth.authenticated || !online || hasPendingSync || signingOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-extrabold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={async () => {
              if (signingOut || hasPendingSync || !online) return;
              setSigningOut(true);
              try { await onSignOut(); } finally { setSigningOut(false); }
            }}
          >
            <LogOut className="h-4 w-4" /> {signingOut ? 'Đang xử lý...' : 'Đăng xuất'}
          </button>
          <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] leading-relaxed text-slate-400"><CircleHelp className="h-3.5 w-3.5 shrink-0" /> Sử dụng tài khoản Firebase hiện tại, không thay đổi dữ liệu.</p>
        </div>
      )}
    </div>
  );
};
