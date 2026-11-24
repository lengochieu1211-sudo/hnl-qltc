/** Local-only, account/project/target-scoped editor drafts. Never enters business sync.
 * Compare the observed value before replacing/removing it; this detects sequential
 * edits in other tabs (localStorage is not an atomic cross-tab transaction).
 */
export interface DraftStorage { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void }
export interface HighlightDraftScope { uid:string; projectId:string }
export interface DraftSlot<T> { key:string; observed:string|null; value:T|null; storage:DraftStorage }
export function highlightDraftKey(scope:HighlightDraftScope|undefined,kind:'count'|'calibration',...ids:string[]):string|null {
  if(!scope?.uid || !scope.projectId || scope.projectId==='default' || ids.some(id=>!id))return null;
  return 'hnl_highlight_draft_v1:'+JSON.stringify([scope.uid,scope.projectId,kind,...ids]);
}
export function openHighlightDraft<T>(key:string|null,validate:(value:unknown)=>value is T,storage?:DraftStorage):DraftSlot<T> {
  if(!key)throw new Error('Chưa xác minh tài khoản/dự án để lưu nháp.');
  const store=storage??window.localStorage;
  const observed=store.getItem(key);
  let value:T|null=null;
  if(observed!==null){
    const raw:unknown=JSON.parse(observed);
    if(!raw || typeof raw!=='object' || !('version' in raw) || raw.version!==1 || !('value' in raw) || !validate(raw.value))throw new Error('Bản nháp cũ không đọc được; không tự ghi đè.');
    value=raw.value;
  }
  return {key,observed,value,storage:store};
}
function check<T>(slot:DraftSlot<T>){if(slot.storage.getItem(slot.key)!==slot.observed)throw new Error('Bản nháp đã đổi ở cửa sổ khác; không tự ghi đè.');}
export function writeHighlightDraft<T>(slot:DraftSlot<T>,value:T):void {
  check(slot);
  const raw=JSON.stringify({version:1,value});
  if(raw.length>256000)throw new Error('Bản nháp vượt giới hạn lưu cục bộ.');
  if(raw!==slot.observed)slot.storage.setItem(slot.key,raw);
  slot.observed=raw;slot.value=value;
}
export function removeHighlightDraft<T>(slot:DraftSlot<T>):void {
  check(slot);slot.storage.removeItem(slot.key);slot.observed=null;slot.value=null;
}
export const draftRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const draftNumber=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export const draftOptionalNumber=(v:unknown)=>v===undefined||draftNumber(v);
export const draftPoint=(v:unknown):boolean=>draftRecord(v)&&draftNumber(v.x)&&draftNumber(v.y)&&v.x>=0&&v.x<=100&&v.y>=0&&v.y<=100;
