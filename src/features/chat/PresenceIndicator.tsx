import React from 'react';

export const PresenceIndicator: React.FC<{ online?: boolean; lastSeen?: number; compact?: boolean }> = ({ online = false, lastSeen = 0, compact = false }) => {
  const label = online
    ? 'Online'
    : lastSeen > 0
      ? `Offline · ${Math.max(1, Math.round((Date.now() - lastSeen) / 60000))} phút trước`
      : 'Offline';
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? 'text-[10px]' : 'text-xs'} text-slate-500`}>
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      {label}
    </span>
  );
};
