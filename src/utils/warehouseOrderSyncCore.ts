import { evaluateWarehouseOrderInput, type WarehouseOrderValues } from './warehouseCatalogOrder';

/** Distinct key: cannot collide with any JSON tuple returned by warehouseOrderKey. */
export const ORDER_DATE_KEY = '__HNL_WAREHOUSE_ORDER_EXPECTED_DATE__';
export type CloudOrderEntry = {
  itemKey: string;
  projectId: string;
  quantity: number;
  kgPerUnit: number | null;
  quantityExpression: string;
  kgPerUnitExpression: string;
  expectedDeliveryDate: string;
  revision: number;
  updatedAt: number;
  updatedByUid: string;
};
export type DraftValue = Pick<CloudOrderEntry, 'quantity'|'kgPerUnit'|'quantityExpression'|'kgPerUnitExpression'|'expectedDeliveryDate'>;
export type PendingOrderChange = { value: DraftValue; baseRevision: number | null };
const LIMIT = 1e12;
export function validOrderDate(date: string): boolean {
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y,m,d]=date.split('-').map(Number);
  const candidate=new Date(Date.UTC(y,m-1,d));
  return y>=2000&&y<=2099&&candidate.getUTCFullYear()===y&&candidate.getUTCMonth()===m-1&&candidate.getUTCDate()===d;
}
export function normalizedDraftValue(raw: unknown): DraftValue | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
  const x=raw as Record<string,unknown>;
  const quantity=x.quantity,kg=x.kgPerUnit;
  const date=x.expectedDeliveryDate ?? '';
  if (typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<0||quantity>LIMIT ||
    (kg!==null&&(typeof kg!=='number'||!Number.isFinite(kg)||kg<=0||kg>LIMIT)) ||
    typeof date!=='string'||!validOrderDate(date)) return null;
  const q=quantity as number, w=kg as number|null;
  const qRaw=typeof x.quantityExpression==='string'?x.quantityExpression:'';
  const kgRaw=typeof x.kgPerUnitExpression==='string'?x.kgPerUnitExpression:'';
  const matches=(text:string,field:'quantity'|'kgPerUnit',number:number|null)=> !text || (text.length<=160&&number!==null&&
    ((v)=>v!==null&&Math.abs(v-number)<=1e-8*Math.max(1,Math.abs(number)))(evaluateWarehouseOrderInput(text,field)));
  return {quantity:q,kgPerUnit:w,quantityExpression:matches(qRaw,'quantity',q)?qRaw:'',kgPerUnitExpression:matches(kgRaw,'kgPerUnit',w)?kgRaw:'',expectedDeliveryDate:date};
}
export function orderRowToDraft(row:DraftValue):WarehouseOrderValues {
  const out:WarehouseOrderValues={quantity:row.quantity,kgPerUnit:row.kgPerUnit};
  if(row.quantityExpression)out.quantityExpression=row.quantityExpression;
  if(row.kgPerUnitExpression)out.kgPerUnitExpression=row.kgPerUnitExpression;
  return out;
}
export function draftToOrderValue(row:WarehouseOrderValues):DraftValue {
  return normalizedDraftValue({quantity:row.quantity,kgPerUnit:row.kgPerUnit,
    quantityExpression:row.quantityExpression||'',kgPerUnitExpression:row.kgPerUnitExpression||'',expectedDeliveryDate:''}) ||
    {quantity:0,kgPerUnit:null,quantityExpression:'',kgPerUnitExpression:'',expectedDeliveryDate:''};
}
export function orderDateValue(date:string):DraftValue {
  return {quantity:0,kgPerUnit:null,quantityExpression:'',kgPerUnitExpression:'',expectedDeliveryDate:date};
}
export function cloudOrderRecord(raw:unknown,id:string,projectId:string):CloudOrderEntry|null {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const x=raw as Record<string,unknown>;
  if(typeof x.itemKey!=='string'||x.itemKey.length>500||x.itemKey.length===0||
    encodeURIComponent(x.itemKey)!==id||x.projectId!==projectId||!Number.isSafeInteger(x.revision)||Number(x.revision)<1||
    typeof x.updatedByUid!=='string'||typeof x.updatedAt!=='number') return null;
  const value=normalizedDraftValue(x);
  if(!value) return null;
  return {...value,itemKey:x.itemKey,projectId,revision:Number(x.revision),updatedAt:x.updatedAt,updatedByUid:x.updatedByUid};
}
export function loadPendingOrderChanges(projectId:string,actorUid:string):Record<string,PendingOrderChange>{
  if(!projectId||!actorUid||typeof localStorage==='undefined')return {};
  try{
    const parsed:unknown=JSON.parse(localStorage.getItem('hnl-qltc-order-cloud-pending-v1:'+projectId+':'+actorUid)||'{}');
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
    const out:Record<string,PendingOrderChange>={};
    for(const [key,entry] of Object.entries(parsed)){
      if(key.length>500||(!key.startsWith('[')&&key!==ORDER_DATE_KEY)||!entry||typeof entry!=='object')continue;
      const p=entry as Record<string,unknown>;const value=normalizedDraftValue(p.value);
      if(value&&(p.baseRevision===null||(Number.isSafeInteger(p.baseRevision)&&Number(p.baseRevision)>=1)))out[key]={value,baseRevision:p.baseRevision as number|null};
    }
    return out;
  }catch{return {};}
}
export function savePendingOrderChanges(projectId:string,actorUid:string,pending:Record<string,PendingOrderChange>):boolean{
  if(!projectId||!actorUid||typeof localStorage==='undefined')return false;
  try{localStorage.setItem('hnl-qltc-order-cloud-pending-v1:'+projectId+':'+actorUid,JSON.stringify(pending));return true;}catch{return false;}
}
export function loadOrderExpectedDate(projectId:string):string {
  if(!projectId||typeof localStorage==='undefined')return '';
  try{const v=localStorage.getItem('hnl-qltc-order-date-v1:'+projectId)||'';return validOrderDate(v)?v:'';}catch{return '';}
}
export function saveOrderExpectedDate(projectId:string,date:string):boolean {
  if(!projectId||typeof localStorage==='undefined'||!validOrderDate(date))return false;
  try{localStorage.setItem('hnl-qltc-order-date-v1:'+projectId,date);return true;}catch{return false;}
}

/** Immutable one-time safety copy before first Cloud merge of old device drafts. */
export function ensureOrderLegacyBackup(projectId:string,rows:Record<string,WarehouseOrderValues>):boolean {
  if(!projectId||typeof localStorage==='undefined')return false;
  try{
    const key='hnl-qltc-order-precloud-backup-v1:'+projectId;
    if(localStorage.getItem(key)!==null)return true;
    if(Object.keys(rows).length===0)return true;
    localStorage.setItem(key,JSON.stringify(rows));
    return true;
  }catch{return false;}
}
export function loadOrderLegacyBackup(projectId:string):Record<string,WarehouseOrderValues> {
  if(!projectId||typeof localStorage==='undefined')return {};
  try{
    const key='hnl-qltc-order-precloud-backup-v1:'+projectId;
    const data=JSON.parse(localStorage.getItem(key)||'{}');
    if(!data||typeof data!=='object'||Array.isArray(data))return {};
    const out:Record<string,WarehouseOrderValues>={};
    for(const [itemKey,row] of Object.entries(data)){
      if(!itemKey.startsWith('[')||itemKey.length>500||!row||typeof row!=='object')continue;
      const clean=normalizedDraftValue({...row as Record<string,unknown>,expectedDeliveryDate:''});
      if(clean)out[itemKey]=orderRowToDraft(clean);
    }
    return out;
  }catch{return {};}
}
