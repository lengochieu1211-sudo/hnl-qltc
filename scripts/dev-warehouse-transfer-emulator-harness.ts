/**
 * Playwright-only bridge to the application's real warehouse transfer service.
 * Not imported by runtime bundles. Refuses any non-demo Firebase project.
 */
import { doc, getDocFromServer, setDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db, auth, APP_ENVIRONMENT, FIREBASE_EMULATOR_ENABLED, FIREBASE_EMULATOR_PROJECT_ID } from '../src/lib/firebaseBase';
import {
  createWarehouseProjectTransferAtomic,
  receiveWarehouseProjectTransferAtomic,
  warehouseTransferId, warehouseTransferReceiptId,
} from '../src/lib/warehouseProjectTransfer';
import { getWarehouseMaterialKey } from '../src/utils/warehouseLedgerMath';
import type { InventoryItem } from '../src/types';

const demoProject = 'demo-hnl-qltc-dev';
const watches = new Map<string, { updates: string[]; unsubscribe: Unsubscribe }>();
function guard() {
  if (import.meta.env.PROD || APP_ENVIRONMENT !== 'DEV' || !FIREBASE_EMULATOR_ENABLED ||
      FIREBASE_EMULATOR_PROJECT_ID !== demoProject || auth.app.options.projectId !== demoProject) {
    throw new Error('REFUSING: DEV WAREHOUSE GOLDEN REQUIRES ISOLATED EMULATOR');
  }
  if (!auth.currentUser) throw new Error('TEST_EMULATOR_AUTH_REQUIRED');
}
const key = (unit = 'tấm') => getWarehouseMaterialKey({ itemKind: 'material' as const, materialName: 'Tấm TC', unit });
const item = (id: string, quantity: number, unit: string): InventoryItem => ({
  id, type:'out', itemKind:'material', materialName:'Tấm TC', quantity, unit,
  date:'2026-11-05', handler:'Auto Test', location:'Kho công trình A', notes:'DEV-EMULATOR-ONLY',
});
const ref = (pid:string, bucket:string, id:string) => doc(db,'projects',pid,bucket,id);
async function serverRead(pid:string,bucket:string,id:string) {
  const snap=await getDocFromServer(ref(pid,bucket,id));
  return snap.exists()?snap.data():null;
}

export async function execute(op:string, data:{
  a?:string; b?:string; id?:string; quantity?:number; unit?:string; mappedUnit?:string;
}={}) {
  guard();
  const a=data.a||'',b=data.b||'',id=data.id||'XK-TEST-10';
  const unit=data.unit||'tấm',qty=data.quantity??10;
  const transferId=warehouseTransferId(a,id);
  const receiptId=warehouseTransferReceiptId(transferId);
  switch(op) {
    case 'identity': return {email:auth.currentUser?.email,uid:auth.currentUser?.uid};
    case 'seed': {
      if(auth.currentUser?.email!=='admin@hnl.test') throw new Error('SEED_ADMIN_ONLY');
      const uid=auth.currentUser.uid,email=auth.currentUser.email;
      for(const pid of [a,b]) {
        await setDoc(doc(db,'projects',pid),{
          id:pid,name:`Auto Test ${pid}`,ownerUid:uid,ownerEmail:email,
          createdAt:Date.now(),updatedAt:Date.now(),
        });
        if(pid===b) await setDoc(ref(pid,'members','editor@hnl.test'),{
          email:'editor@hnl.test',role:'EDITOR',active:true,assignedAt:Date.now(),
        });
        await setDoc(ref(pid,'members','viewer@hnl.test'),{
          email:'viewer@hnl.test',role:'VIEWER',active:true,assignedAt:Date.now(),
        });
      }
      // Diagnostic: B has an existing zero balance for the same material.
      // This distinguishes receipt-voucher permissions from new balance creation.
      await setDoc(ref(b,'inventory_balances',key('tấm')),{
        id:key('tấm'),projectId:b,itemKind:'material',materialId:null,materialName:'Tấm TC',
        unit:'tấm',onHand:0,revision:1,updatedAt:Date.now(),updatedByUid:uid,
      });
      for(const [u,onHand] of [['tấm',10],['m2',3]] as const) {
        await setDoc(ref(a,'inventory_balances',key(u)),{
          id:key(u),projectId:a,itemKind:'material',materialId:null,materialName:'Tấm TC',
          unit:u,onHand,revision:1,updatedAt:Date.now(),updatedByUid:uid,
        });
      }
      return {a,b,email};
    }
    case 'out': return createWarehouseProjectTransferAtomic(a,b,item(id,qty,unit));
    case 'in': return receiveWarehouseProjectTransferAtomic(b,transferId,{
      materialName:'Tấm TC',unit:data.mappedUnit||unit,
    },auth.currentUser?.email||'');
    case 'state': {
      const [sourceBalance,targetBalance,outgoing,incoming,receipt]=await Promise.all([
        serverRead(a,'inventory_balances',key(unit)),
        serverRead(b,'inventory_balances',key(unit)),
        serverRead(a,'inventory',id),
        serverRead(b,'warehouse_incoming',transferId),
        serverRead(b,'inventory',receiptId),
      ]);
      return {
        sourceOnHand:sourceBalance?.onHand??null,
        targetOnHand:targetBalance?.onHand??0,
        outgoing:outgoing?{id:outgoing.id,quantity:outgoing.quantity,unit:outgoing.unit}:null,
        incoming:incoming?{status:incoming.status,quantity:incoming.quantity,unit:incoming.unit}:null,
        receipt:receipt?{id:receipt.id,quantity:receipt.quantity}:null,
      };
    }
    case 'watch': {
      watches.get(b)?.unsubscribe();
      const updates:string[]=[];
      const unsubscribe=onSnapshot(ref(b,'warehouse_incoming',transferId),snap=>{
        updates.push(snap.exists()?String(snap.data().status):'missing');
      },error=>updates.push(`ERROR:${error.code}`));
      watches.set(b,{updates,unsubscribe});
      return true;
    }
    case 'updates': return watches.get(b)?.updates||[];
    case 'stopWatch': watches.get(b)?.unsubscribe();watches.delete(b);return true;
    default:throw new Error('UNKNOWN_EMULATOR_TEST_OP:'+op);
  }
}
