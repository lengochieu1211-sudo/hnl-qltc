import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, LockKeyhole, WifiOff } from 'lucide-react';
import { APP_VERSION } from '../config/appVersion';
import { BUILD_METADATA } from '../config/buildMetadata';
import {
  getCurrentRealFirebaseUser,
  signInWithGoogle,
  subscribeToFirebaseAuthSettled,
} from '../lib/firebase';
import { getRememberedVerifiedAuthIdentity } from '../utils/offlineAccess';

type AuthGateState = 'checking' | 'authenticated' | 'offline-remembered' | 'signed-out';

interface AppAuthGateProps {
  children: React.ReactNode;
}

const googleMark = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09A6.78 6.78 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.06H2.18A10.96 10.96 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

export const AppAuthGate: React.FC<AppAuthGateProps> = ({ children }) => {
  const [state, setState] = useState<AuthGateState>('checking');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );

  const evaluateAuth = () => {
    const realUser = getCurrentRealFirebaseUser();
    if (realUser) {
      setState('authenticated');
      return;
    }
    const remembered = typeof navigator !== 'undefined' && !navigator.onLine
      ? getRememberedVerifiedAuthIdentity()
      : null;
    setState(remembered ? 'offline-remembered' : 'signed-out');
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToFirebaseAuthSettled(() => {
      if (!active) return;
      evaluateAuth();
    });
    const handleConnectivity = () => {
      if (active) evaluateAuth();
    };
    window.addEventListener('online', handleConnectivity);
    window.addEventListener('offline', handleConnectivity);

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleTheme = () => setPrefersDark(Boolean(media?.matches));
    media?.addEventListener?.('change', handleTheme);

    if (getCurrentRealFirebaseUser()) setState('authenticated');
    else if (!navigator.onLine && getRememberedVerifiedAuthIdentity()) setState('offline-remembered');

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', handleConnectivity);
      window.removeEventListener('offline', handleConnectivity);
      media?.removeEventListener?.('change', handleTheme);
    };
  }, []);

  const appEnv = useMemo(() => BUILD_METADATA.environment, []);

  if (state === 'authenticated' || state === 'offline-remembered') {
    return <>{children}</>;
  }

  const handleLogin = async () => {
    try {
      setLoginBusy(true);
      setLoginError('');
      const user = await signInWithGoogle();
      if (user) evaluateAuth();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoginBusy(false);
    }
  };

  const dark = prefersDark;
  const isDev = appEnv === 'DEV';

  if (state === 'checking') {
    return (
      <div
        className={`min-h-[100dvh] w-full flex items-center justify-center px-4 ${dark ? 'bg-slate-950 text-slate-200' : 'bg-slate-50 text-slate-700'}`}
        data-hnl-auth-gate="checking"
      >
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span>Đang khôi phục phiên đăng nhập…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative min-h-[100dvh] w-full overflow-hidden ${dark ? 'bg-slate-950 text-slate-100' : 'bg-[#f7faff] text-slate-950'}`}
      data-hnl-auth-gate={state}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 ${dark
          ? 'bg-[radial-gradient(circle_at_18%_8%,rgba(37,99,235,0.24),transparent_34%),radial-gradient(circle_at_90%_78%,rgba(14,165,233,0.10),transparent_34%)]'
          : 'bg-[radial-gradient(circle_at_16%_10%,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_88%_82%,rgba(14,165,233,0.10),transparent_34%)]'}`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -left-24 top-[18%] h-64 w-64 rotate-45 rounded-[54px] ${dark ? 'bg-blue-900/10' : 'bg-blue-100/45'}`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -right-24 top-10 h-72 w-72 rotate-45 rounded-[64px] ${dark ? 'bg-sky-900/10' : 'bg-sky-100/40'}`}
      />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(34px,env(safe-area-inset-top))] sm:px-7">
        <div className="flex flex-1 flex-col justify-center py-5">
          <div className="text-center">
            <img
              src={`/icon.png?v=${APP_VERSION}-auth-blue`}
              alt="HNL QLTC"
              className="mx-auto h-28 w-28 object-contain drop-shadow-[0_16px_28px_rgba(37,99,235,0.16)]"
              draggable={false}
            />
            <h1 className="mt-5 text-[34px] font-black tracking-[-0.045em] sm:text-4xl">
              HNL <span className="text-blue-600">QLTC</span>
            </h1>
            <p className={`mt-1.5 text-[15px] font-semibold ${dark ? 'text-slate-300' : 'text-slate-500'}`}>
              Quản lý thi công thông minh
            </p>
            <div className="mx-auto mt-4 h-1 w-14 rounded-full bg-gradient-to-r from-blue-600 to-sky-400" />
          </div>

          <div className={`mt-10 rounded-[30px] border p-5 shadow-[0_20px_60px_rgba(15,23,42,0.10)] backdrop-blur-sm sm:p-6 ${dark ? 'border-slate-800 bg-slate-900/88' : 'border-white/90 bg-white/92'}`}>
            <h2 className="text-center text-xl font-black tracking-[-0.025em]">Đăng nhập để tiếp tục</h2>
            <p className={`mx-auto mt-2 max-w-xs text-center text-[13px] leading-relaxed ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              Dùng tài khoản Google đã được cấp quyền để mở đúng dự án.
            </p>

            {loginError && (
              <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${dark ? 'border-rose-900/70 bg-rose-950/50 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                {loginError}
              </div>
            )}

            <button
              type="button"
              onClick={handleLogin}
              disabled={loginBusy}
              className="mt-6 flex min-h-14 w-full items-center justify-between rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-sky-500 px-4 text-white shadow-[0_14px_30px_rgba(37,99,235,0.30)] transition hover:-translate-y-px hover:from-blue-500 hover:to-sky-400 active:translate-y-0 active:scale-[0.995] disabled:cursor-wait disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm">
                  {loginBusy ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> : googleMark}
                </span>
                <span className="text-sm font-black sm:text-[15px]">
                  {loginBusy ? 'Đang mở Google…' : 'Đăng nhập với Google'}
                </span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0" />
            </button>

            <div className={`mt-5 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[11px] leading-relaxed ${dark ? 'bg-slate-800/80 text-slate-400' : 'bg-blue-50/70 text-slate-500'}`}>
              <LockKeyhole className={`mt-0.5 h-4 w-4 shrink-0 ${dark ? 'text-blue-300' : 'text-blue-600'}`} />
              <span>Mã PIN chỉ dùng để mở khóa nhanh sau khi tài khoản Google đã được xác minh.</span>
            </div>

            {typeof navigator !== 'undefined' && !navigator.onLine && (
              <div className={`mt-3 flex items-start gap-2 rounded-2xl px-3.5 py-3 text-[11px] ${dark ? 'bg-amber-950/40 text-amber-200' : 'bg-amber-50 text-amber-700'}`}>
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Thiết bị đang ngoại tuyến. Cần có mạng để đăng nhập Google lần đầu.</span>
              </div>
            )}
          </div>
        </div>

        <div className={`pb-1 text-center text-[10px] font-bold tracking-[0.08em] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
          <div className="flex items-center justify-center gap-2">
            {isDev && (
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black tracking-[0.12em] ${dark ? 'bg-blue-950 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                DEV
              </span>
            )}
            <span>v{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
