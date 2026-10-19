/**
 * Resolve safe Quick Edit history shortcuts without taking over a browser's
 * native undo in search/toolbar inputs. Inside grid cells, use the app's
 * draft history (including a focused input/select), like a spreadsheet.
 * @param {{key?: string,ctrlKey?: boolean,metaKey?: boolean,altKey?: boolean,shiftKey?: boolean,isComposing?: boolean,targetTagName?: string,isContentEditable?: boolean,inGridCell?: boolean}} event
 * @returns {'undo'|'redo'|null}
 */
export function quickGridHistoryShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return null;
  if (event.isContentEditable || /^(TEXTAREA)$/i.test(event.targetTagName || '')) return null;
  if (!event.inGridCell && /^(INPUT)$/i.test(event.targetTagName || '')) return null;
  const key = (event.key || '').toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
