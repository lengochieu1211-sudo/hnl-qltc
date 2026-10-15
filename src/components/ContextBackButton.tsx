import React from 'react';
import { ArrowLeft } from 'lucide-react';

/** Consistent, source-aware return action for cross-module links and nested sheets. */
interface ContextBackButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const ContextBackButton: React.FC<ContextBackButtonProps> = ({ label, className = '', ...props }) => (
  <button
    {...props}
    type="button"
    data-hnl-context-back-button="true"
    className={`inline-flex min-h-10 max-w-full shrink-0 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    title={`Quay lại ${label}`}
    aria-label={`Quay lại ${label}`}
  >
    <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span className="min-w-0 truncate">Quay lại {label}</span>
  </button>
);
