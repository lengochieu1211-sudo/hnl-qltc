import React from 'react';
export const UnreadBadge: React.FC<{ count: number }> = ({ count }) => {
  if (count <= 0) return null;
  return <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold inline-flex items-center justify-center">{count > 9 ? '9+' : count}</span>;
};
