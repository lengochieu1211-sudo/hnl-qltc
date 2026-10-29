import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,query,where,getDoc,getDocs,setDoc} from 'firebase/firestore';

const folder='qa-firebase-rules',p='demo-hnl-dev-backup-allowlist';
assert.equal(process.env.GCLOUD_PROJECT,p);
assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS,'CLOUD_CREDS_MUST_BE_ABSENT_IN_EMULATOR');
const email=JSON.parse(fs.readFileSync(folder+'/test-account.json','utf8')).email;
const rules=fs.readFileSync(folder+'/candidate.rules','utf8');
const env=await initializeTestEnvironment({projectId:p,firestore:{rules,host:'127.0.0.1',port:8080}});
const projectId='demo-guard-tests',adminEmail='lengochieu1211@gmail.com';
const token=(email,email_verified=true,sign_in_provider='google.com')=>({
  email,email_verified,firebase:{sign_in_provider}
});
const admin=env.authenticatedContext('admin-uid',token(adminEmail)).firestore();
const editor=env.authenticatedContext('editor-uid',token(email)).firestore();
const outsider=env.authenticatedContext('unlisted-uid',token('unlisted@example.invalid')).firestore();
const unverified=env.authenticatedContext('unverified-uid',token(email,false)).firestore();
const password=env.authenticatedContext('password-uid',token(email,true,'password')).firestore();
const fixture=async db=>{
  await setDoc(doc(db,'projects',projectId),{
    id:projectId,name:'DEV Backup QA isolated fixture',
    ownerUid:'admin-uid',ownerEmail:adminEmail,
    createdAt:Date.now(),updatedAt:Date.now()
  });
  await setDoc(doc(db,'projects',projectId,'members',email),{
    email,role:'EDITOR',active:true,assignedAt:Date.now()
  });
  await setDoc(doc(db,'projectAccess',projectId+'__'+encodeURIComponent(email)),{
    projectId,email,projectName:'DEV Backup QA isolated fixture',role:'EDITOR',active:true
  });
  await setDoc(doc(db,'projectInvitations',projectId+'_'+email),{
    projectId,projectName:'DEV Backup QA isolated fixture',
    email,invitedEmail:email,role:'EDITOR',createdByUid:'admin-uid'
  });
};
try{
  await env.withSecurityRulesDisabled(ctx=>fixture(ctx.firestore()));
  await assertSucceeds(getDoc(doc(admin,'projects',projectId)));
  await assertSucceeds(getDoc(doc(editor,'projects',projectId)));
  await assertSucceeds(getDoc(doc(editor,'projects',projectId,'members',email)));
  await assertSucceeds(getDocs(query(collection(editor,'projectAccess'),where('email','==',email))));
  await assertSucceeds(setDoc(doc(editor,'users','editor-uid'),{
    uid:'editor-uid',email,projects:{[projectId]:{id:projectId,name:'QA',role:'EDITOR'}}
  },{merge:true}));
  await assertFails(getDoc(doc(outsider,'projects',projectId)));
  await assertFails(getDoc(doc(unverified,'projects',projectId)));
  await assertFails(getDoc(doc(password,'projects',projectId)));
  await assertFails(getDoc(doc(outsider,'users','editor-uid')));
  await assertFails(setDoc(doc(editor,'projects',projectId,'members',email),
    {email,role:'ADMIN',active:true},{merge:true}));
  console.log('PASS DEV Backup Rules allowlisted EDITOR discovers project and own index, unlisted/unverified/password denied, no ADMIN escalation');
}finally{
  await env.cleanup();
}
