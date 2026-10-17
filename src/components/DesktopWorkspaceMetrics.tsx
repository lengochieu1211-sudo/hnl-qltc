import React from 'react';

interface WorkspaceMetric {
  label: string;
  value: number | string;
  detail?: string;
  tone?: 'default' | 'success' | 'warning';
}

/** Display-only measurements sourced from each module's existing filtered arrays.
 * This component makes no network requests, stores no state and performs no writes.
 */
export const DesktopWorkspaceMetrics: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  metrics: WorkspaceMetric[];
}> = ({ eyebrow, title, description, metrics }) => (
  <section className="hnl-pc-v2-overview" aria-label={title}>
    <div className="hnl-pc-v2-overview-intro">
      <span className="hnl-pc-v2-eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
    <div className="hnl-pc-v2-metric-grid">
      {metrics.map(({ label, value, detail, tone = 'default' }) => (
        <div className={`hnl-pc-v2-metric hnl-pc-v2-metric--${tone}`} key={label}>
          <span className="hnl-pc-v2-metric-label">{label}</span>
          <strong className="hnl-pc-v2-metric-value">{value}</strong>
          {detail ? <small>{detail}</small> : null}
        </div>
      ))}
    </div>
  </section>
);
