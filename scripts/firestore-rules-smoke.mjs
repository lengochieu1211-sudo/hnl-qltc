// Fail closed: perform the real Auth/Firestore/Storage Emulator rules tests.
// A printed "PASS" without an emulator run would hide security regressions.
import './firebase-rules-check.mjs';
