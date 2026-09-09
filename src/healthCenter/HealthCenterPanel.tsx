import React, { useMemo } from 'react';
import { HealthCenterPanel as HealthCenterPanelBase } from './HealthCenterPanelBase';
import { createHnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import { buildHealthCenterReport, type HealthCenterIssue } from './healthCenterEngine';
import { buildHealthCenterNavigationRequest, type DiagnosticNavigationRequest } from './healthCenterNavigation';

type HealthCenterPanelProps = React.ComponentProps<typeof HealthCenterPanelBase>;
const array = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export const HealthCenterPanel: React.FC<HealthCenterPanelProps> = (props) => {
  const report = useMemo(() => {
    if (!props.projectId || !props.accessVerified) return null;
    const data = props.fullAppData || {};
    const snapshot = createHnlAiProjectSnapshot({
      projectId: props.projectId,
      projectName: props.projectName || data.projectName || '',
      rooms: array(data.roomProgressList),
      defects: array(data.defects),
      crewRecords: array(data.crewRecords),
      teams: array(data.teams),
      floors: array(data.floorPlans),
      workVolumes: array(data.workVolumes),
      inventory: array(data.inventory),
      materialNorms: array(data.materialNorms),
      checklist: array(data.checklist),
      asOf: Date.now(),
      freshness: props.freshness === 'cache' ? 'cache' : 'live',
    });
    return buildHealthCenterReport({
      context: { projectId: props.projectId, role: props.userRole, accessVerified: props.accessVerified, screen: 'health-center', timeZone: 'Asia/Ho_Chi_Minh' },
      snapshot,
    });
  }, [props.accessVerified, props.freshness, props.fullAppData, props.projectId, props.projectName, props.userRole]);

  const navigate = (issue: HealthCenterIssue): boolean => {
    const request = buildHealthCenterNavigationRequest(props.projectId, issue);
    if (!request.entityId) return false;

    if (request.entityType === 'crewRecord') {
      try { sessionStorage.setItem('qlct_diagnostic_navigation_request', JSON.stringify(request)); } catch (_) {}
      window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: request }));
      return true;
    }

    if (request.entityType === 'defect') {
      try {
        sessionStorage.setItem('qlct_pending_defect_navigation', JSON.stringify({
          projectId: props.projectId,
          defectId: request.entityId,
          floorId: request.floorId || '',
        }));
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: request }));
      return true;
    }

    if (request.entityType === 'room') {
      try { sessionStorage.setItem('qlct_diagnostic_navigation_request', JSON.stringify(request)); } catch (_) {}
      window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: request }));
      return true;
    }

    return false;
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement | null)?.closest('button');
    if (!button || !/(Xem bản ghi|Xử lý)/i.test(String(button.textContent || ''))) return;
    if (!report) return;

    let node: HTMLElement | null = button.parentElement;
    let issue: HealthCenterIssue | undefined;
    while (node && !issue) {
      const content = String(node.textContent || '');
      issue = report.issues.find((candidate) => content.includes(`${candidate.ruleId} · ${candidate.entityType}:${candidate.entityId}`));
      if (issue) break;
      node = node.parentElement;
    }
    if (!issue) return;
    if (!navigate(issue)) return;

    event.preventDefault();
    event.stopPropagation();
  };

  return <div onClickCapture={handleClickCapture}><HealthCenterPanelBase {...props} /></div>;
};
