import type { FloorPlan, RoomProgressItem, RoomQuantityFormulaSetting, RoomSubItem, WorkVolume } from '../types';
import { measureBasicRoomQuantitySource } from './roomHighlightBasicMetric';
import { evaluateRoomQuantityFormula, hasLinkedQuantityVariables, type QuantityVariables } from './roomQuantityFormula';
import { normalizeUnit, areSameUnit, isHighlightLengthUnit } from './unitUtils';

const norm = (s:string) => s.trim().toLocaleLowerCase('vi-VN');
const own = (o:object,k:string) => Object.prototype.hasOwnProperty.call(o,k);
function catalogMatches(cat:string, catalog:WorkVolume[], floorId:string) {
  const all=catalog.filter(v=>!v.deletedAt&&(v.id===cat||v.workCategoryId===cat||norm(v.title||'')===norm(cat)));
  const scoped=all.filter(v=>v.floorId===floorId||v.floorIds?.includes(floorId));
  return scoped.length?scoped:all;
}
export function roomFormulaCategoryKey(cat:string,catalog:WorkVolume[],floorId:string,fallback:string):string {
  const ids=[...new Set(catalogMatches(cat,catalog,floorId).map(v=>v.workCategoryId||v.id).filter(Boolean))];
  return ids.length===1?'id:'+ids[0]:'legacy:'+fallback;
}

/**
 * Recalculate opt-in settings only on an explicit authorized room/floor mutation.
 * No side effects, no network, no migration. A manually changed value, ambiguous
 * identity/unit, invalid calibration, locked room, or finalized stage stays intact.
 */
export function recalculateLinkedRoomQuantities(room:RoomProgressItem,floor:FloorPlan|undefined,catalog:WorkVolume[]):RoomProgressItem {
  if(!room.quantityFormulaSettings || room.deletedAt || room.positionLocked || room.inspectionStatus==='Đạt nghiệm thu' ||
    !floor || floor.deletedAt || room.floorId!==floor.id) return room;
  const settings=room.quantityFormulaSettings;
  const volumes=room.categoryVolumes||{};
  const categories=new Set<string>([...(room.workCategory?[room.workCategory]:[]),...(room.subItems||[]).map(s=>s.category||room.workCategory||''),...Object.keys(volumes)].filter(Boolean));
  // Resolve exact authoritative category and a unique existing storage key. Never create a duplicate alias.
  const resolve=(category:string)=>{
    const matches=catalogMatches(category,catalog,room.floorId);
    const ids=[...new Set(matches.map(v=>v.workCategoryId||v.id).filter(Boolean))];
    const units=[...new Set(matches.map(v=>normalizeUnit(v.unit||'')).filter(Boolean))];
    if(ids.length!==1||units.length!==1)return null;
    const aliases=new Set([category,ids[0],...matches.flatMap(v=>[v.id,v.title])]);
    const keys=Object.keys(volumes).filter(k=>aliases.has(k));
    if(keys.length!==1)return null;
    const key=keys[0],unit=units[0],categoryKey='id:'+ids[0];
    const savedUnit=room.categoryVolumeUnits?.[key]||room.categoryVolumeUnits?.[category];
    if(savedUnit&&!areSameUnit(savedUnit,unit))return null;
    return {key,unit,categoryKey};
  };
  let nextVolumes=volumes, nextSettings=settings, nextWorkVolume=room.workVolume;
  const failedMain=new Set<string>();
  const evaluate=(setting:RoomQuantityFormulaSetting,actual:number|undefined,unit:string,parent?:number,parentUnit?:string)=>{
    if(!setting || setting.auto!==true || typeof setting.expression!=='string' || setting.expression.length>256 ||
       !Number.isFinite(actual) || actual!==setting.value || !areSameUnit(setting.unit||'',unit))return null;
    const expression=setting.expression.trim().replace(/^=/,'').toUpperCase();
    if(!hasLinkedQuantityVariables(expression))return null;
    if(expression==='S'&&!areSameUnit(unit,'m²') || (expression==='L'||expression==='P')&&!isHighlightLengthUnit(unit) ||
       expression==='KL'&&(!parentUnit||!areSameUnit(unit,parentUnit)))return null;
    const vars:QuantityVariables={};
    const names: string[] = expression.match(/[A-Z]+/g)||[];
    for(const [name,source] of [['S','area'],['P','perimeter'],['L','linear']] as const){
      if(!names.includes(name))continue;
      const c=floor.highlightMetricCalibration;
      if(!c||floor.imageOfflineStale)return null;
      const m=measureBasicRoomQuantitySource({room,floor,source,image:{width:c.sourceWidthPx,height:c.sourceHeightPx}});
      if(!m.valid)return null;
      vars[name]=m.value;
    }
    if(names.includes('KL')){
      if(typeof parent!=='number'||!Number.isFinite(parent)||parent<0)return null;
      vars.KL=parent;
    }
    const result=evaluateRoomQuantityFormula(expression,vars);
    if(!result.valid)return null;
    const value=Math.round(result.value*100)/100;
    return Number.isFinite(value)?value:null;
  };
  const seen=new Set<string>();
  for(const cat of categories){
    const resolved=resolve(cat);if(!resolved||seen.has(resolved.categoryKey))continue;
    seen.add(resolved.categoryKey);
    const id='main:'+resolved.categoryKey,setting=settings[id];
    if(!setting||setting.categoryKey!==resolved.categoryKey||setting.auto!==true)continue;
    const value=evaluate(setting,volumes[resolved.key],resolved.unit);
    if(value===null){failedMain.add(resolved.categoryKey);continue;}
    if(value===volumes[resolved.key])continue;
    nextVolumes={...nextVolumes,[resolved.key]:value};
    nextSettings={...nextSettings,[id]:{...setting,value}};
    const primary=room.workCategory?resolve(room.workCategory):null;
    if(primary?.categoryKey===resolved.categoryKey)nextWorkVolume=value;
  }
  let subChanged=false;
  const nextSubItems=room.subItems?.map((stage:RoomSubItem)=>{
    if(stage.status==='Đã hoàn thành'||stage.inspectionStatus==='Đạt nghiệm thu')return stage;
    const id='sub:'+stage.id,setting=settings[id];
    if(!setting||setting.auto!==true)return stage;
    const resolved=resolve(stage.category||room.workCategory||'');
    if(!resolved||setting.categoryKey!==resolved.categoryKey)return stage;
    if(failedMain.has(resolved.categoryKey)&&/\bKL\b/i.test(setting.expression))return stage;
    const unit=normalizeUnit(stage.volumeUnit||resolved.unit);
    const value=evaluate(setting,stage.workVolume,unit,nextVolumes[resolved.key],resolved.unit);
    if(value===null||value===stage.workVolume)return stage;
    subChanged=true;
    nextSettings={...nextSettings,[id]:{...setting,value}};
    return {...stage,workVolume:value};
  });
  if(nextVolumes===volumes&&!subChanged)return room;
  return {...room,categoryVolumes:nextVolumes,quantityFormulaSettings:nextSettings,
    ...(nextWorkVolume!==undefined?{workVolume:nextWorkVolume}:{}),...(subChanged?{subItems:nextSubItems}: {})};
}
