import React, { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  props: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React Component Tree:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearAndReload = () => {
    if (window.confirm('Khôi phục ứng dụng về trạng thái mặc định ban đầu? Tất cả bộ nhớ đệm tạm sẽ được làm sạch.')) {
      try {
        localStorage.clear();
      } catch (err) {
        console.error('Failed to clear localStorage:', err);
      }
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 text-center">
            <div className="w-16 h-16 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mx-auto border border-rose-500/30 animate-pulse">
              <AlertTriangle className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-lg font-black text-slate-100">Đã xảy ra sự cố không mong muốn</h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ứng dụng gặp lỗi giao diện. Vui lòng thử tải lại trang hoặc khôi phục để tiếp tục sử dụng.
              </p>
              {this.state.error && (
                <div className="bg-slate-950 p-2.5 rounded-xl text-[10px] font-mono text-rose-300 text-left overflow-x-auto max-h-24 border border-rose-900/40">
                  {this.state.error.toString()}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
              >
                <RefreshCw className="w-4 h-4" /> Tải Lại Trang
              </button>

              <button
                type="button"
                onClick={this.handleClearAndReload}
                className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold rounded-xl text-xs transition-all active:scale-95"
              >
                Khôi Phục Mặc Định (Reset)
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
