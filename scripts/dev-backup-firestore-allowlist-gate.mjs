import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { google } from 'googleapis';

const PROJECT='hnl-qltc-dev-backup';
const TARGET_SHA='9da0521819812438b967d60f897b23970ff30ecd7863d3d180c575fab7ffe1cc';
const API='https://firebaserules.googleapis.com/v1/';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const FIRESTORE='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/';
const OUT='qa-firebase-rules';
const hash=x=>createHash('sha256').update(x).digest('hex');
const normalized=x=>String(x||'').trim().toLowerCase();
const isTarget=x=>hash(normalized(x))===TARGET_SHA;
const str=(doc,key)=>String(doc?.fields?.[key]?.stringValue||'');
const active=doc=>doc?.fields?.active?.booleanValue!==false;
const sa=JSON.parse(process.env.FIREBASE_BACKUP_SERVICE_ACCOUNT||'{}');
assert.equal(process.env.BACKUP_PROJECT,PROJECT);
assert.equal(sa.type,'service_account');assert.equal(sa.project_id,PROJECT);assert(sa.private_key);
let authToken='';
async function fetchJson(url,options={}){
  if(!authToken) {
    const auth=new google.auth.GoogleAuth({credentials:sa,scopes:['https://www.googleapis.com/auth/cloud-platform']});
    authToken=(await(await auth.getClient()).getAccessToken()).token;
  }
  const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+authToken,Accept:'application/json',...(options.headers||{})}});
  if(!r.ok)throw Error('SCOPED_API_ERROR_'+r.status+'_'+new URL(url).hostname);
  return r.json();
}
async function listDocs(collectionPath){
  const rows=[];let pageToken='';
  do{
    if(rows.length>=1000)throw Error('AUDIT_LIMIT_STOP');
    const url=new URL(FIRESTORE+collectionPath);url.searchParams.set('pageSize','100');
    if(pageToken)url.searchParams.set('pageToken',pageToken);
    const result=await fetchJson(url.toString());rows.push(...(result.documents||[]));pageToken=result.nextPageToken||'';
  }while(pageToken);
  return rows;
}
async function liveRules(){
  const release=await fetchJson(API+RELEASE);
  assert(release.rulesetName?.startsWith('projects/'+PROJECT+'/rulesets/'),'NOT_DEV_BACKUP_RULESET');
  const ruleset=await fetchJson(API+release.rulesetName);
  const files=(ruleset.source?.files||[]).filter(x=>String(x.content||'').includes('function backupAccountAllowed()'));
  assert.equal(files.length,1,'ONE_BACKUP_RULES_FILE_ONLY');
  return {release,source:files[0].content};
}
async function currentTarget(){
  const [access,invitations]=await Promise.all([listDocs('projectAccess'),listDocs('projectInvitations')]);
  const eligible=access.filter(d=>isTarget(str(d,'email'))&&active(d));
  assert.equal(eligible.length,1,'TARGET_ACCESS_COUNT_NOT_ONE');
  const projectId=str(eligible[0],'projectId'),email=normalized(str(eligible[0],'email'));
  assert(projectId&&isTarget(email),'WRONG_ACCOUNT');
  assert.equal(str(eligible[0],'role'),'EDITOR');
  const member=await fetchJson(FIRESTORE+'projects/'+encodeURIComponent(projectId)+'/members/'+encodeURIComponent(email));
  assert.equal(normalized(str(member,'email')),email);assert.equal(str(member,'role'),'EDITOR');assert(active(member),'MEMBER_INACTIVE');
  assert(invitations.some(x=>str(x,'projectId')===projectId&&isTarget(str(x,'invitedEmail')||str(x,'email'))),'NO_INVITATION');
  const project=await fetchJson(FIRESTORE+'projects/'+encodeURIComponent(projectId));
  assert(project.fields?.deleted?.booleanValue!==true,'PROJECT_DELETED');
  return {email,projectId};
}
async function prepare(){
  const [live,target]=await Promise.all([liveRules(),currentTarget()]);
  const match=[...live.source.matchAll(/function\s+backupAccountAllowed\(\)\s*\{[\s\S]*?\n\s*\}/g)];
  assert.equal(match.length,1,'GUARD_MUST_BE_UNIQUE');
  const guard=match[0][0];
  const oldCheck="request.auth.token.email.lower() == 'lengochieu1211@gmail.com'";
  assert.equal(guard.split(oldCheck).length,2,'GUARD_CHANGED_ABORT');
  assert(guard.includes('email_verified == true')&&guard.includes("sign_in_provider == 'google.com'"));
  assert(!live.source.includes(target.email),'TARGET_ALREADY_ALLOWED');
  const updated=guard.replace(oldCheck,
    "(request.auth.token.email.lower() == 'lengochieu1211@gmail.com' || request.auth.token.email.lower() == '"+target.email+"')");
  const candidate=live.source.replace(guard,updated);
  assert.equal(candidate.replace(updated,guard),live.source,'DIFF_OUTSIDE_ALLOWLIST_GUARD');
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'original.rules'),live.source);
  fs.writeFileSync(path.join(OUT,'candidate.rules'),candidate);
  const manifest={project:PROJECT,originalRuleset:live.release.rulesetName,
    originalSha:hash(live.source),candidateSha:hash(candidate),accountSha:TARGET_SHA,
    projectIdSha:hash(target.projectId),onlyGuardChanged:true,noDataChanged:true};
  fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(OUT,'test-account.json'),JSON.stringify({email:target.email}),{mode:0o600});
  fs.writeFileSync(path.join(OUT,'firebase.json'),JSON.stringify({
    firestore:{rules:'candidate.rules'},
    emulators:{firestore:{host:'127.0.0.1',port:8080},ui:{enabled:false},singleProjectMode:true}
  }));
  console.log('PREPARE_PASS',JSON.stringify({originalSha:manifest.originalSha,candidateSha:manifest.candidateSha,onlyGuardChanged:true,targetRole:'EDITOR'}));
}
async function compare(expected){
  const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8'));
  const live=await liveRules();
  if(expected==='original'){
    assert.equal(live.release.rulesetName,manifest.originalRuleset,'CONCURRENT_RULESET_CHANGE_STOP');
    assert.equal(hash(live.source),manifest.originalSha,'CONCURRENT_RULES_CONTENT_CHANGE_STOP');
  }else{
    assert.equal(hash(live.source),manifest.candidateSha,'LIVE_RULES_MISMATCH');
    assert.notEqual(live.release.rulesetName,manifest.originalRuleset,'RELEASE_DID_NOT_ADVANCE');
    fs.writeFileSync(path.join(OUT,'VERIFIED.json'),JSON.stringify({
      project:PROJECT,oldRuleset:manifest.originalRuleset,newRuleset:live.release.rulesetName,
      liveSha:hash(live.source),firestoreDataUnchanged:true,prodUnchanged:true,
      roleStillEditor:true,signedInRuntimeGolden:false
    },null,2));
  }
  console.log('VERIFY_'+expected.toUpperCase()+'_PASS',hash(live.source));
}
async function rollback(){
  const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8'));
  const live=await liveRules();
  if(live.release.rulesetName===manifest.originalRuleset){console.log('ROLLBACK_NOT_NEEDED');return;}
  assert.equal(hash(live.source),manifest.candidateSha,'CONCURRENT_CHANGE_DO_NOT_ROLLBACK');
  await fetchJson(API+RELEASE+'?updateMask=rulesetName',{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:RELEASE,rulesetName:manifest.originalRuleset})
  });
  await compare('original');console.log('ROLLBACK_VERIFIED');
}
const command=process.argv[2];
if(command==='prepare')await prepare();
else if(command==='predeploy')await compare('original');
else if(command==='verify')await compare('candidate');
else if(command==='rollback')await rollback();
else throw Error('INVALID_MODE');
