#!/usr/bin/env node
// P21.92 audit-only: new atomic Chat client vs OLD PROD Firestore Rules; localhost demo emulators.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,collection,setDoc,getDoc,getDocs,writeBatch,increment,serverTimestamp} from 'firebase/firestore';
const projectId=process.env.GCLOUD_PROJECT||process.env.FIREBASE_PROJECT_ID;
if(!/^demo-[a-z0-9-]+$/.test(projectId||'')||
   !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||
   !/^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST||'')) throw Error('P2192_DEMO_LOOPBACK_ONLY');
const mainSha='b2557860fbb3b128b5f2c9863e99d0f8b1f78686';
const candidateSha='ce6f4e586b70f76a6c94ab8ae4a966b8e841e2e0';
const oldRules=execFileSync('git',['show',mainSha+':firestore.rules'],{encoding:'utf8'});
assert.equal(fs.readFileSync('.p2192-old.rules','utf8'),oldRules,'exact old PROD rules required');
const newSource=execFileSync('git',['show',candidateSha+':src/lib/chatService.ts'],{encoding:'utf8'});
assert.match(newSource,/batch\.set\(msgRef,/);
assert.match(newSource,/lastMessageId:\s*messageId/);
assert.match(newSource,/batch\.set\(conversationRef\(/);
const nonce=Date.now().toString(36),pid='p2192-phased-'+nonce,apps=[];
async function account(label){
 const email=label+'-'+nonce+'@example.test';
 const app=initializeApp({apiKey:'demo-key',authDomain:projectId+'.firebaseapp.com',projectId},'p2192-'+label+'-'+nonce);
 apps.push(app);
 const auth=getAuth(app),db=getFirestore(app);
 connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
 connectFirestoreEmulator(db,'127.0.0.1',8080);
 const user=(await createUserWithEmailAndPassword(auth,email,'P2192-OnlyLocal-123456!')).user;
 return {db,uid:user.uid,email};
}
const ref=(a,...parts)=>doc(a.db,'projects',pid,...parts);
const sumRef=(a,conv)=>ref(a,'conversations',conv);
const msgRef=(a,conv,id)=>ref(a,'conversations',conv,'messages',id);
const msgCol=(a,conv)=>collection(a.db,'projects',pid,'conversations',conv,'messages');
function message(a,conv,id){return {
 id,projectId:pid,conversationId:conv,senderUid:a.uid,senderEmail:a.email,
 senderName:'P21.92 synthetic',clientMessageId:id,createdAt:serverTimestamp(),
 text:'P21.92 localhost '+id,attachments:[],mentions:[],editedAt:null,deletedAt:null
};}
function summary(a,conv,id,newClient){return {
 id:conv,projectId:pid,lastSenderUid:a.uid,lastSenderName:'P21.92 synthetic',
 lastMessageAt:serverTimestamp(),lastMessageText:'P21.92 localhost',
 messageCount:increment(1),updatedAt:serverTimestamp(),
 ...(newClient?{lastMessageId:id}:{})
};}
async function newClientSend(a,conv,id){
 const batch=writeBatch(a.db);
 batch.set(msgRef(a,conv,id),message(a,conv,id));
 batch.set(sumRef(a,conv),summary(a,conv,id,true),{merge:true});
 await batch.commit();
}
async function oldClientSend(a,conv,id){
 await setDoc(msgRef(a,conv,id),message(a,conv,id));
 await setDoc(sumRef(a,conv),summary(a,conv,id,false),{merge:true});
}
const evidence={
 test:'P21.92 new client / OLD PROD Rules compatibility',
 sourceMain:mainSha,candidateSource:candidateSha,
 environment:'LOCAL_AUTH_FIRESTORE_EMULATORS_ONLY',
 prodModified:false,realGoogleAccounts:false,cloudCredentialsUsed:false,
 oldRulesSecurityCertified:false,realDeviceGolden:false,oldClientVsNewRulesGatePass:false
};
try{
 const owner=await account('owner'),sender=await account('sender'),viewer=await account('viewer');
 await setDoc(ref(owner),{id:pid,name:'P21.92 QA',ownerUid:owner.uid,ownerEmail:owner.email,createdAt:Date.now(),updatedAt:Date.now()});
 for(const [a,role] of [[sender,'EDITOR'],[viewer,'VIEWER']])
   await setDoc(ref(owner,'members',a.email),{email:a.email,role,active:true,assignedAt:Date.now()});
 const firstId=sender.uid+'_new-first';
 await newClientSend(sender,'new-first-conversation',firstId);
 assert.equal((await getDoc(sumRef(viewer,'new-first-conversation'))).data().messageCount,1);
 assert.equal((await getDoc(msgRef(viewer,'new-first-conversation',firstId))).exists(),true);
 await newClientSend(sender,'general',sender.uid+'_new-1');
 await oldClientSend(sender,'general',sender.uid+'_legacy-2');
 await newClientSend(sender,'general',sender.uid+'_new-3');
 const count=(await getDoc(sumRef(viewer,'general'))).data().messageCount;
 const actual=(await getDocs(msgCol(viewer,'general'))).size;
 assert.equal(count,3,'old Rules must accept mixed new atomic + legacy summaries');
 assert.equal(actual,3,'three messages persisted');
 Object.assign(evidence,{
  newClientFirstConversation:true,mixedOldNewClients:true,generalMessages:actual,generalSummaryCount:count,
  status:'PASS_CLIENT_FIRST_OLD_RULES_EMULATOR_ONLY',phasedRolloutCertified:false,
  remainingHardBlockers:['legacy clients vs new Rules','real Web/APK/EXE upgrade/offline outbox','real roles/media','scoped rollback']
 });
 fs.mkdirSync('evidence',{recursive:true});
 fs.writeFileSync('evidence/P2192-CLIENT-FIRST-OLD-RULES.json',JSON.stringify(evidence,null,2)+'\n');
 console.log('P21.92 PHASED COMPATIBILITY '+JSON.stringify(evidence));
}finally{await Promise.all(apps.map(a=>deleteApp(a).catch(()=>{})));}
