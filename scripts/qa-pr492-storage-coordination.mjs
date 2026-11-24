import assert from 'node:assert/strict';
import {cleanupTransientLocalStorage,safeSetLocalStorageItem} from '../src/utils/storage.ts';
const protectedKeys=['firestore_clients_demo','firestore_mutations_demo','firestore_targets_demo','firestore_online_state_demo','firestore_sequence_number_demo','firestore_zombie_demo','firebase:authUser:demo','construction_business_data'];
const store=new Map(protectedKeys.map(k=>[k,'preserve:'+k]));
store.set('construction_offline_pending','retired');
let failOnce=false;
Object.defineProperty(globalThis,'localStorage',{value:{get length(){return store.size},key(i){return [...store.keys()][i]??null},getItem(k){return store.get(k)??null},removeItem(k){store.delete(k)},setItem(k,v){if(failOnce){failOnce=false;throw Object.assign(new Error('quota'),{name:'QuotaExceededError'})}store.set(k,v)}},configurable:true});
assert.equal(cleanupTransientLocalStorage().removed,1);
for(const k of protectedKeys)assert.equal(store.get(k),'preserve:'+k);
store.set('construction_offline_pending','retired');
failOnce=true;
assert.equal(safeSetLocalStorageItem('qa-pref','value'),true);
for(const k of protectedKeys)assert.equal(store.get(k),'preserve:'+k);
assert.equal(store.has('construction_offline_pending'),false);
console.log('PASS: startup and quota cleanup preserve Firestore coordination, identity and business keys');

// Sustained quota pressure must fail safely without removing SDK/auth/business keys.
localStorage.setItem('construction_offline_pending','retired');
const previousSet=localStorage.setItem;
localStorage.setItem=()=>{throw Object.assign(new Error('quota sustained'),{name:'QuotaExceededError'})};
assert.equal(safeSetLocalStorageItem('qa-pref-2','value'),false);
for(const k of protectedKeys)assert.equal(store.get(k),'preserve:'+k);
assert.equal(store.has('qa-pref-2'),false);
localStorage.setItem=previousSet;
console.log('PASS: sustained quota failure preserves protected keys');
