import React, { useState, useEffect } from 'react';
import { Lock, Unlock, ShieldAlert, KeyRound, UserCheck, RefreshCw } from 'lucide-react';
import { getStoredPinLockConfig, savePinLockConfig, logAuditAction } from '../utils/securityUtils';
import { verifyPin } from '../utils/cryptoUtils';
import { signInWithGoogle } from '../lib/firebase';

interface AppLockOverlayProps {
  isLocked: boolean;
  onUnlock: () => void;
}

export const AppLockOverlay: React.FC<AppLockOverlayProps> = ({ isLocked, onUnlock }) => {
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleResetting, setIsGoogleResetting] = useState(false);

  useEffect(() => {
    if (isLocked) {
      setPinInput('');
      setErrorMsg('');
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleDigitClick = (digit: string) => {
    if (pinInput.length < 6) {
      setPinInput(prev => prev + digit);
      setErrorMsg('');
    }
  };

  const handleDeleteDigit = () => {
    setPinInput(prev => prev.slice(0, -1));
    setErrorMsg('');
  };

  const handleVerify = async (pinToTest = pinInput) => {
    if (pinToTest.length < 4) {
      setErrorMsg('Mã PIN phải từ 4 đến 6 chữ số');
      return;
    }

    try {
      setIsVerifying(true);
      const config = getStoredPinLockConfig();
      if (!config.pinHash || !config.pinSalt) {
        // Fallback if no PIN saved
        onUnlock();
        return;
      }

      const isValid = await verifyPin(pinToTest, config.pinHash, config.pinSalt);
      if (isValid) {
        setPinInput('');
        setErrorMsg('');
        logAuditAction('SECURITY_CONFIG_CHANGE', 'Mở khóa ứng dụng thành công bằng mã PIN');
        onUnlock();
      } else {
        setErrorMsg('Mã PIN không chính xác. Vui lòng thử lại!');
        setPinInput('');
      }
    } catch (err: any) {
      setErrorMsg('Lỗi xác thực: ' + (err?.message || 'Thử lại'));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleForgotPinWithGoogle = async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setErrorMsg('Cần kết nối Internet để xác minh tài khoản và đặt lại mã PIN.');
      return;
    }

    try {
      setIsGoogleResetting(true);
      setErrorMsg('');
      const user = await signInWithGoogle();
      if (user && user.email) {
        try {
          const { saveUserProfileToCloud } = await import('../lib/firebase');
          await saveUserProfileToCloud(user);
        } catch (_) {}

        const currentConfig = getStoredPinLockConfig();
        // Check if PIN has a recorded owner UID
        if (currentConfig.pinOwnerUid && currentConfig.pinOwnerUid !== user.uid) {
          setErrorMsg('Tài khoản này không có quyền đặt lại mã PIN.');
          return;
        }

        // Re-authenticated via Google Auth successfully! Reset PIN hash cleanly.
        savePinLockConfig({
          ...currentConfig,
          enabled: false,
          pinHash: undefined,
          pinSalt: undefined,
          pinOwnerUid: undefined,
          pinOwnerEmail: undefined
        });
        logAuditAction('SECURITY_CONFIG_CHANGE', `Đã đặt lại (reset) mã PIN qua đăng nhập lại Google Auth (${user.email})`);
        alert(`🎉 Xác thực Google Auth thành công (${user.email})!\n\nMã PIN khóa ứng dụng đã được xóa. Bạn có thể mở khóa và đặt lại mã PIN mới trong cài đặt bảo mật.`);
        setPinInput('');
        setErrorMsg('');
        onUnlock();
      } else {
        setErrorMsg('Đăng nhập Google thất bại hoặc bị hủy.');
      }
    } catch (err: any) {
      console.error('Google Re-auth PIN reset error:', err);
      setErrorMsg('Lỗi khi xác thực Google: ' + (err?.message || 'Thử lại'));
    } finally {
      setIsGoogleResetting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleVerify();
    } else if (e.key === 'Backspace') {
      handleDeleteDigit();
    } else if (/^[0-9]$/.test(e.key)) {
      if (pinInput.length < 6) {
        const next = pinInput + e.key;
        setPinInput(next);
        if (next.length === 6) {
          handleVerify(next);
        }
      }
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 bg-slate-950 z-[9999] flex items-center justify-center p-4 select-none outline-none"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xs w-full shadow-lg text-center flex flex-col items-center space-y-5">
        
        {/* Shield Icon */}
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
          <Lock className="w-8 h-8 " />
        </div>

        <div>
          <h2 className="text-lg font-black text-white tracking-wide">Khóa Ứng Dụng</h2>
          <p className="text-xs text-slate-400 mt-1">
            Nhập mã PIN bảo mật để tiếp tục sử dụng
          </p>
        </div>

        {/* PIN Dots Indicator */}
        <div className="flex items-center justify-center gap-3 py-2">
          {[0, 1, 2, 3, 4, 5].map(idx => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full transition-colors duration-75 ${
                idx < pinInput.length
                  ? 'bg-indigo-500 scale-110 shadow-sm shadow-indigo-500/50'
                  : 'bg-slate-800 border border-slate-700'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {errorMsg ? (
          <div className="text-rose-400 text-xs font-semibold flex items-center gap-1.5 justify-center bg-rose-950/40 border border-rose-900/50 px-3 py-1.5 rounded-xl">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <div className="h-7 text-[11px] text-slate-500 flex items-center justify-center">
            {pinInput.length >= 4 ? 'Nhấn Mở Khóa hoặc tiếp tục nhập 6 số' : 'Mã PIN gồm 4 - 6 số'}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5 w-full pt-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => {
                const next = pinInput + d;
                if (pinInput.length < 6) {
                  setPinInput(next);
                  if (next.length === 6) {
                    handleVerify(next);
                  }
                }
              }}
              className="h-12 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-black text-lg border border-slate-700/50 transition-colors active:opacity-80 cursor-pointer flex items-center justify-center"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={handleDeleteDigit}
            className="h-12 rounded-2xl bg-slate-800/40 hover:bg-slate-800 text-slate-400 font-bold text-xs border border-slate-800 transition-colors active:opacity-80 cursor-pointer flex items-center justify-center"
          >
            Xóa
          </button>
          <button
            type="button"
            onClick={() => {
              const next = pinInput + '0';
              if (pinInput.length < 6) {
                setPinInput(next);
                if (next.length === 6) {
                  handleVerify(next);
                }
              }
            }}
            className="h-12 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-black text-lg border border-slate-700/50 transition-colors active:opacity-80 cursor-pointer flex items-center justify-center"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => handleVerify()}
            disabled={isVerifying || pinInput.length < 4}
            className="h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs transition-colors active:opacity-80 cursor-pointer flex items-center justify-center shadow-lg shadow-indigo-600/30"
          >
            <Unlock className="w-4 h-4" />
          </button>
        </div>

        {/* Forgot PIN / Reset via Google Auth */}
        <div className="w-full pt-1">
          <button
            type="button"
            onClick={handleForgotPinWithGoogle}
            disabled={isGoogleResetting}
            className="w-full py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 border border-slate-700/60 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            {isGoogleResetting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Đang xác thực Google...</span>
              </>
            ) : (
              <>
                <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Quên mã PIN? Đặt lại bằng Google Auth</span>
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-slate-500 pt-0.5">
          Mã PIN được mã hóa 1 chiều. Không có master PIN.
        </p>
      </div>
    </div>
  );
};
