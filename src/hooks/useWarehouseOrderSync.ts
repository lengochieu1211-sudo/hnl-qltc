import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {loadWarehouseOrderDraft,saveWarehouseOrderDraft,type WarehouseOrderValues} from '../utils/warehouseCatalogOrder';
import {subscribeWarehouseOrderCloud,saveWarehouseOrderCloudRow,WarehouseOrderRevisionConflict} from '../lib/warehouseOrderCloud';
import {
  ORDER_DATE_KEY,draftToOrderValue,orderDateValue,orderRowToDraft,
  loadPendingOrderChanges,savePendingOrderChanges,loadOrderExpectedDate,
  saveOrderExpectedDate,validOrderDate,ensureOrderLegacyBackup,loadOrderLegacyBackup,
  type CloudOrderEntry,type DraftValue,type PendingOrderChange,
} from '../utils/warehouseOrderSyncCore';

const empty:WarehouseOrderValues={quantity:0,kgPerUnit:null};
/** One authoritative warehouse-order Cloud queue at app scope. Shared by order sheet and the existing Sync Center. */
export function useWarehouseOrderSync(projectId:string,actorUid:string,canEdit:boolean,accessAllowed:boolean){
  const [draft,setDraft]=useState<Record<string,WarehouseOrderValues>>(()=>loadWarehouseOrderDraft(projectId));
  const [saveError,setSaveError]=useState(false);
  const [expectedDate,setExpectedDate]=useState(()=>loadOrderExpectedDate(projectId));
  const [cloudState,setCloudState]=useState<'loading'|'ready'|'offline'|'error'>('loading');
  const [cloudError,setCloudError]=useState('');
  const [pendingCount,setPendingCount]=useState(0);
  const [conflicts,setConflicts]=useState<string[]>([]);
  const rowsRef=useRef(draft);
  const pendingRef=useRef<Record<string,PendingOrderChange>>(loadPendingOrderChanges(projectId,actorUid));
  const remoteRef=useRef<Record<string,CloudOrderEntry>>({});
  const readyRef=useRef(false);
  // Invalidate all late transactions/snapshots when switching project, user or sheet.
  const syncEpochRef=useRef(0);
  const inFlightRef=useRef(new Set<string>());
  const conflictsRef=useRef(new Set<string>());

  const persistPending=useCallback(()=>{
    setPendingCount(Object.keys(pendingRef.current).length);
    if(!savePendingOrderChanges(projectId,actorUid,pendingRef.current))setSaveError(true);
  },[projectId,actorUid]);
  const updateLocal=useCallback((rows:Record<string,WarehouseOrderValues>)=>{
    rowsRef.current=rows;
    setDraft(rows);
    if(!saveWarehouseOrderDraft(projectId,rows))setSaveError(true);
  },[projectId]);

  // Cloud is authoritative for clean rows; pending local edits NEVER get replaced
  // by a snapshot. Existing pre-cloud local drafts remain as an explicit backup.
  useEffect(()=>{
    const epoch=++syncEpochRef.current;
    rowsRef.current=loadWarehouseOrderDraft(projectId);
    setSaveError(false);
    if(!ensureOrderLegacyBackup(projectId,rowsRef.current))setSaveError(true);
    setDraft(rowsRef.current);
    pendingRef.current=loadPendingOrderChanges(projectId,actorUid);
    remoteRef.current={};readyRef.current=false;inFlightRef.current.clear();conflictsRef.current.clear();
    setPendingCount(Object.keys(pendingRef.current).length);setConflicts([]);
    setExpectedDate(loadOrderExpectedDate(projectId));setCloudError('');
    setCloudState('loading');
    if(!accessAllowed || !projectId || !actorUid || actorUid==='unauthenticated')return;
    const unsubscribe=subscribeWarehouseOrderCloud(projectId,(remote,fromCache)=>{
      if(syncEpochRef.current!==epoch)return;
      remoteRef.current=remote;
      if(!fromCache)readyRef.current=true;
      const updated={...rowsRef.current};
      for(const [key,record] of Object.entries(remote)){
        if(pendingRef.current[key])continue;
        if(key===ORDER_DATE_KEY){
          setExpectedDate(record.expectedDeliveryDate);
          saveOrderExpectedDate(projectId,record.expectedDeliveryDate);
        }else updated[key]=orderRowToDraft(record);
      }
      updateLocal(updated);
      setCloudState(fromCache?'offline':'ready');setCloudError('');
    },err=>{if(syncEpochRef.current!==epoch)return;setCloudState('error');setCloudError(err.message||'Không kết nối được Firestore.');});
    return ()=>{syncEpochRef.current++;unsubscribe();};
  },[projectId,updateLocal,actorUid,accessAllowed]);

  const flushPending=useCallback(()=>{
    if(!canEdit||!accessAllowed||!readyRef.current||(typeof navigator!=='undefined'&&!navigator.onLine))return;
    const epoch=syncEpochRef.current;
    for(const key of Object.keys(pendingRef.current)){
      const pending:PendingOrderChange|undefined=pendingRef.current[key];
      if(!pending)continue;
      if(inFlightRef.current.has(key)||conflictsRef.current.has(key))continue;
      inFlightRef.current.add(key);
      let committed=false;
      void saveWarehouseOrderCloudRow(projectId,key,pending.value,pending.baseRevision).then(()=>{
        // The response belongs to the previous project/account: leave current draft untouched.
        if(syncEpochRef.current!==epoch)return;
        committed=true;
        if(pendingRef.current[key]===pending){
          delete pendingRef.current[key];
          persistPending();
        }else if(pendingRef.current[key]){
          // A newer local edit was made while the previous revision was in flight.
          pendingRef.current[key]={...pendingRef.current[key],baseRevision:(pending.baseRevision??0)+1};
          persistPending();
        }
        setCloudError('');
      }).catch(error=>{
        if(syncEpochRef.current!==epoch)return;
        if(error instanceof WarehouseOrderRevisionConflict){
          conflictsRef.current.add(key);setConflicts([...conflictsRef.current]);
        }else setCloudError(error instanceof Error?error.message:'Không đồng bộ được dữ liệu đặt hàng.');
      }).finally(()=>{
        if(syncEpochRef.current!==epoch)return;
        inFlightRef.current.delete(key);
        // An edit made while the previous transaction was in flight already
        // has a newer baseRevision. Retry it without requiring another click;
        // the queue is durable, and conflicts still stop automatic overwrites.
        if(committed&&pendingRef.current[key]!==pending&&pendingRef.current[key]&&!conflictsRef.current.has(key)){
          queueMicrotask(()=>{if(syncEpochRef.current===epoch)flushPending();});
        }
      });
    }
  },[canEdit,accessAllowed,projectId,persistPending]);
  useEffect(()=>{flushPending();},[flushPending,pendingCount,cloudState]);
  useEffect(()=>{
    window.addEventListener('online',flushPending);
    return ()=>window.removeEventListener('online',flushPending);
  },[flushPending]);
  const queueOrderChange=useCallback((key:string,value:DraftValue)=>{
    if(!canEdit)return;
    const existing=pendingRef.current[key];
    pendingRef.current[key]={value,baseRevision:existing ? existing.baseRevision : (remoteRef.current[key]?.revision ?? null)};
    persistPending();
    // Dependency count may not change if editing an already-pending row; trigger directly.
    flushPending();
  },[canEdit,persistPending,flushPending]);
  const setValue=(key:string,which:'quantity'|'kgPerUnit',value:number|null,expression?:string)=>{
    if(!canEdit)return;
    const existing=rowsRef.current[key]||empty;
    const expressionKey=which==='quantity'?'quantityExpression':'kgPerUnitExpression';
    const next={...existing};
    delete next[expressionKey];
    next[which]=which==='quantity'?(value??0):value;
    if(expression)next[expressionKey]=expression;
    if(existing.quantity===next.quantity&&existing.kgPerUnit===next.kgPerUnit&&
      (existing.quantityExpression||'')===(next.quantityExpression||'')&&
      (existing.kgPerUnitExpression||'')===(next.kgPerUnitExpression||''))return;
    updateLocal({...rowsRef.current,[key]:next});
    queueOrderChange(key,draftToOrderValue(next));
  };
  const updateExpectedDate=(date:string)=>{
    if(!canEdit||!validOrderDate(date)||date===expectedDate)return;
    setExpectedDate(date);
    if(!saveOrderExpectedDate(projectId,date))setSaveError(true);
    queueOrderChange(ORDER_DATE_KEY,orderDateValue(date));
  };
  const importLocalDraft=()=>{
    if(!canEdit||!accessAllowed||!readyRef.current||!window.confirm('Chỉ đồng bộ các dòng cũ CHƯA có trên Cloud. Dữ liệu Cloud đang tồn tại sẽ KHÔNG bị ghi đè. Tiếp tục?'))return;
    // Include the immutable pre-Cloud backup even when a newer Cloud snapshot
    // has replaced the visible local cache. Existing Cloud rows are never overwritten.
    // Prefer the newest local draft; legacy backup only fills keys absent locally.
    const oldRows={...loadOrderLegacyBackup(projectId),...rowsRef.current};
    for(const key of Object.keys(oldRows)){
      const row:WarehouseOrderValues|undefined=oldRows[key];
      if(!row)continue;
      if(remoteRef.current[key]||pendingRef.current[key]||row.quantity<=0&&row.kgPerUnit==null)continue;
      pendingRef.current[key]={value:draftToOrderValue(row),baseRevision:null};
    }
    if(expectedDate&&!remoteRef.current[ORDER_DATE_KEY]&&!pendingRef.current[ORDER_DATE_KEY])
      pendingRef.current[ORDER_DATE_KEY]={value:orderDateValue(expectedDate),baseRevision:null};
    persistPending();flushPending();
  };
  const acceptCloudConflicts=()=>{
    if(!canEdit||!accessAllowed||!readyRef.current||typeof navigator!=='undefined'&&!navigator.onLine)return;
    if(!window.confirm('Lấy giá trị Cloud cho các dòng đang xung đột? Bản nhập ở máy này sẽ bị thay thế.'))return;
    const updated={...rowsRef.current};
    const unresolved:string[]=[];
    for(const key of conflictsRef.current){
      const remote=remoteRef.current[key];if(!remote){unresolved.push(key);continue;}
      if(key===ORDER_DATE_KEY){setExpectedDate(remote.expectedDeliveryDate);saveOrderExpectedDate(projectId,remote.expectedDeliveryDate);}
      else updated[key]=orderRowToDraft(remote);
      delete pendingRef.current[key];
    }
    conflictsRef.current=new Set(unresolved);setConflicts(unresolved);updateLocal(updated);persistPending();
  };
  const eligibleLegacyCount=useMemo(()=>accessAllowed ? Object.entries({...loadOrderLegacyBackup(projectId),...draft}).filter(([key,row])=>
    Boolean(row) && !remoteRef.current[key] && !pendingRef.current[key] && (row.quantity>0||row.kgPerUnit!==null)).length : 0,
    [projectId,draft,pendingCount,cloudState,accessAllowed]);
  return {draft,expectedDate,cloudState,cloudError,saveError,pendingCount,conflicts,eligibleLegacyCount,canEdit,
    setValue,updateExpectedDate,flushPending,importLocalDraft,acceptCloudConflicts};
}

export type WarehouseOrderSync = ReturnType<typeof useWarehouseOrderSync>;
