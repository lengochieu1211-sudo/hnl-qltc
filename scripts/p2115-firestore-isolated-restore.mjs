#!/usr/bin/env node
import fs from 'node:fs';
import {decryptSnapshot,inventory,restoreToEmptyEmulator} from './p2115-firestore-restore-core.mjs';
const encryptedPath=process.env.P2115_ENCRYPTED_FILE,manifestPath=process.env.P2115_MANIFEST_FILE,privateKeyPath=process.env.P2115_PRIVATE_KEY_FILE;
if(!encryptedPath||!manifestPath||!privateKeyPath)throw Error('RESTORE_INPUT_FILES_REQUIRED');
const documents=decryptSnapshot({encrypted:fs.readFileSync(encryptedPath),manifest:JSON.parse(fs.readFileSync(manifestPath,'utf8')),privateKeyPem:fs.readFileSync(privateKeyPath)});
const source=inventory(documents),restored=await restoreToEmptyEmulator({host:process.env.FIRESTORE_EMULATOR_HOST,targetProject:process.env.P2115_RESTORE_TARGET,documents});
console.log(JSON.stringify({status:'ISOLATED_FIRESTORE_EMULATOR_RESTORE_PASS',source,restored}));
