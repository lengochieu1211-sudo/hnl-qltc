import React, { useEffect, useState } from 'react';
import { subscribeConfirm } from '../utils/confirmAsync';
import { AlertCircle } from 'lucide-react';

export const GlobalConfirmModal: React.FC = () => {
  const [confirmData, setConfirmData] = useState<{ message: string, resolve: (r: boolean) => void } | null>(null);

  useEffect(() => {
    return subscribeConfirm((data) => {
      setConfirmData(data);
    });
  }, []);

  if (!confirmData) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">Xác nhận</h3>
          <p className="text-sm text-slate-600 font-medium mb-6">
            {confirmData.message}
          </p>
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={() => confirmData.resolve(false)}
              className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={() => confirmData.resolve(true)}
              className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition-colors shadow-sm shadow-rose-200"
            >
              Đồng ý
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
