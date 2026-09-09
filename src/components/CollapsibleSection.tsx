import React from 'react';
import { ExpandCollapseButton } from './ExpandCollapseButton';

interface CollapsibleSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  id?: string;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  summary?: React.ReactNode;
  expandLabel?: string;
  collapseLabel?: string;
  buttonClassName?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  expanded,
  onToggle,
  id,
  className = '',
  headerClassName = '',
  contentClassName = '',
  summary,
  expandLabel,
  collapseLabel,
  buttonClassName = '',
}) => {
  const contentId = id ? `${id}-content` : undefined;

  return (
    <section className={className}>
      <div className={`flex items-start justify-between gap-3 ${headerClassName}`}>
        <div className="min-w-0 flex-1">
          <div>{title}</div>
          {!expanded && summary ? <div className="mt-1 text-[10px] text-slate-500">{summary}</div> : null}
        </div>
        <ExpandCollapseButton
          expanded={expanded}
          onToggle={onToggle}
          controls={contentId}
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
          className={buttonClassName}
        />
      </div>
      {expanded ? (
        <div id={contentId} className={contentClassName}>
          {children}
        </div>
      ) : null}
    </section>
  );
};
