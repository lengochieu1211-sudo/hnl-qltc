import React, { useState } from 'react';
import { 
  X, 
  Cloud, 
  CheckCircle2, 
  LogOut, 
  ShieldCheck, 
  User, 
  Mail, 
  Lock,
  ExternalLink,
  Info
} from 'lucide-react';
import { GoogleAuthStatus } from '../types';
import {
  FIREBASE_EMULATOR_ENABLED,
  signInWithEmulatorTestAccount,
  signInWithGoogleAccount,
  signOutFirebaseAccount,
  type EmulatorTestAccountKind,
} from '../lib/firebase';

interface GoogleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  authStatus: GoogleAuthStatus;
  onRefreshAuth: () => void;
}

export const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  isOpen,
  onClose,
  authStatus,
  onRefreshAuth,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const user = await signInWithGoogleAccount();
      // Redirect sign-in navigates away on mobile; desktop popup returns a User.
      if (user) onRefreshAuth();
    } catch (err: any) {
      setErrorMsg('Khong the dang nhap Google bang Firebase Auth: ' + (err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLoading(true);
      await signOutFirebaseAccount();
      onRefreshAuth();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmulatorLogin = async (kind: EmulatorTestAccountKind) => {
    try {
      setLoading(true);
      setErrorMsg(null);
      await signInWithEmulatorTestAccount(kind);
      onRefreshAuth();
    } catch (err: any) {
      setErrorMsg('Không thể đăng nhập tài khoản DEV Emulator: ' + (err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl p-5 space-y-4 border border-slate-100 shadow-2xl relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon & Title */}
        <div className="text-center space-y-1.5 pt-2">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-xs">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {authStatus.authenticated ? 'Tài Khoản Google Của Bạn' : 'Đăng nhập Google/Firebase'}
          </h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            {authStatus.authenticated
              ? 'Tài khoản Google đã kết nối qua Firebase Auth và được dùng chung trong toàn ứng dụng.'
              : 'Chỉ cần đăng nhập một lần. Firebase dùng tài khoản này; Drive chính HNL được Apps Script xử lý riêng.'}
          </p>
        </div>

        {/* Content Body */}
        {authStatus.authenticated ? (
          <div className="space-y-3 pt-2">
            <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl flex items-center gap-3">
              {Boolean(authStatus.picture) ? (
                <img
                  src={authStatus.picture}
                  alt={authStatus.name || 'User'}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  className="w-11 h-11 rounded-full object-cover border-2 border-emerald-500 shadow-sm"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-emerald-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
                  {(authStatus.name || authStatus.email || 'G')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="font-bold text-slate-900 text-xs truncate">{authStatus.name || 'Thành viên Google'}</p>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                </div>
                <p className="text-[11px] text-slate-600 truncate">{authStatus.email}</p>
                <span className="inline-block mt-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                  Đã đăng nhập
                </span>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs space-y-1.5 text-slate-600">
              <p className="font-semibold text-slate-800">Quyền hạn đã kích hoạt:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>Dang nhap Google bang Firebase Authentication</li>
                <li>Dong bo du lieu qua Firestore free tier khi du cau hinh</li>
                <li>Khong can server rieng, khong goi Google Drive/Sheets tren Hosting tinh</li>
              </ul>
            </div>

            <button
              onClick={handleLogout}
              disabled={loading}
              className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl active:scale-95 transition-all text-xs flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Đăng Xuất Tài Khoản Google
            </button>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2">
                <Info className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {FIREBASE_EMULATOR_ENABLED && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                <div>
                  <p className="text-[11px] font-bold text-amber-900">DEV Emulator Golden</p>
                  <p className="text-[10px] text-amber-800">Tài khoản giả lập chỉ tồn tại trong Firebase Emulator; không thể đăng nhập vào PROD.</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['ADMIN', 'EDITOR', 'VIEWER'] as EmulatorTestAccountKind[]).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={loading}
                      onClick={() => handleEmulatorLogin(kind)}
                      className="rounded-lg border border-amber-300 bg-white px-2 py-2 text-[10px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs flex items-center justify-center gap-2.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{loading ? 'Đang đăng nhập...' : 'Tiếp Tục Với Tài Khoản Google'}</span>
            </button>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-[11px] text-slate-500 space-y-1">
              <p className="font-bold text-slate-700 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                Bảo mật &amp; Quyền riêng tư:
              </p>
              <p>
                Khi bấm đăng nhập, bạn sẽ liên kết tài khoản Google cá nhân/doanh nghiệp của mình để lưu trữ thông tin công trình an toàn.
              </p>
            </div>
          </div>
        )}

        <div className="pt-2 text-center">
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-600 font-bold"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
