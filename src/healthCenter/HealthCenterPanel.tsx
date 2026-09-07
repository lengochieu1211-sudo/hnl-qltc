import React, { useMemo } from 'react';
import { HealthCenterPanel as HealthCenterPanelBase } from './HealthCenterPanelBase';
import { createHnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import { buildHealthCenterReport, type HealthCenterIssue } from './healthCenterEngine';
import { buildHealthCenterNavigationRequest, type DiagnosticNavigationRequest } from './healthCenterNavigation';

type HealthCenterPanelProps = React.ComponentProps<typeof HealthCenterPanelBase>;
const array = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function openRoomCardAfterTabSwitch(request: DiagnosticNavigationRequest): void {
  if (!request.roomName) return;
  let attempt = 0;
  const tryOpen = () => {
    attempt += 1;
    const labels = Array.from(document.querySelectorAll<HTMLElement>('span[title]'));
    const label = labels.find((node) => String(node.getAttribute('title') || '').trim() === request.roomName);
    if (label) {
      let container: HTMLElement | null = label.parentElement;
      while (container && container !== document.body) {
        const editButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
          const value = String(button.textContent || '').trim();
          return value === 'Chỉnh sửa' || value === 'Cập nhật';
        });
        if (editButton) {
          container.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const previousOutline = container.style.outline;
          container.style.outline = '3px solid #6366f1';
          window.setTimeout(() => { container!.style.outline = previousOutline; }, 2400);
          editButton.click();
          return;
        }
        container = container.parentElement;
      }
    }
    if (attempt < 14) window.setTimeout(tryOpen, 180);
    else alert(`Đã mở đúng tầng nhưng chưa tìm thấy thẻ căn/phòng “${request.roomName}”. Hãy quét lại Health Center để kiểm tra ID/tên căn hiện tại.`);
  };
  window.setTimeout(tryOpen, 180);
}

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

    if (request.entityType === 'room' && request.floorId && request.roomName) {
      try {
        localStorage.setItem(`construction_selected_floor_id_${props.projectId}`, request.floorId);
        localStorage.setItem(`construction_selected_view_mode_${props.projectId}`, 'highlight');
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: { ...request, entityType: 'defect' } }));
      openRoomCardAfterTabSwitch(request);
      return true;
    }

    return false;
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement | null)?.closest('button');
    if (!button || !/Xem bản ghi/i.test(String(button.textContent || ''))) return;
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
