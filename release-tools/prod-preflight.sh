#!/usr/bin/env bash
set -euo pipefail

: "${CANDIDATE_SHA:?}"
: "${PROD_BASE_SHA:?}"
: "${PROD_FIREBASE_PROJECT_ID:?}"
: "${PROD_HOSTING_URL:?}"
: "${PROD_R2_URL:?}"
: "${PROD_AI_URL:?}"
: "${GITHUB_WORKSPACE:?}"

CONTROL_DIR="$GITHUB_WORKSPACE/control"
CANDIDATE_DIR="$GITHUB_WORKSPACE/candidate"
EVIDENCE_DIR="$GITHUB_WORKSPACE/release-evidence"
BACKUP_BUCKET="gs://hnl-qltc-prod-backup-61329-20260916"
BACKUP_URI="${BACKUP_BUCKET}/firestore/pre-release-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
mkdir -p "$EVIDENCE_DIR"

step() { echo; echo "========== $* =========="; }

step "Audit main -> exact candidate"
cd "$CANDIDATE_DIR"
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA" || { echo "BLOCKED: wrong candidate SHA"; exit 1; }
git fetch origin main --depth=1
ACTUAL_MAIN="$(git rev-parse origin/main)"
test "$ACTUAL_MAIN" = "$PROD_BASE_SHA" || { echo "BLOCKED: main moved from audited PROD base: $ACTUAL_MAIN"; exit 1; }
git merge-base --is-ancestor "$PROD_BASE_SHA" "$CANDIDATE_SHA" || { echo "BLOCKED: PROD main is not an ancestor of candidate"; exit 1; }
AHEAD="$(git rev-list --count "$PROD_BASE_SHA..$CANDIDATE_SHA")"
BEHIND="$(git rev-list --count "$CANDIDATE_SHA..$PROD_BASE_SHA")"
test "$BEHIND" = "0" || { echo "BLOCKED: candidate is behind PROD"; exit 1; }
CHANGED="$(git diff --name-only "$PROD_BASE_SHA..$CANDIDATE_SHA" | wc -l | tr -d ' ')"
git diff --check "$PROD_BASE_SHA..$CANDIDATE_SHA" > "$EVIDENCE_DIR/diff-check-review.txt" 2>&1 || true
{
  echo "prodBaseSha=$PROD_BASE_SHA"
  echo "candidateSha=$CANDIDATE_SHA"
  echo "aheadBy=$AHEAD"
  echo "behindBy=$BEHIND"
  echo "changedFiles=$CHANGED"
  echo "diffCheckReviewLines=$(wc -l < "$EVIDENCE_DIR/diff-check-review.txt" | tr -d ' ')"
} > "$EVIDENCE_DIR/main-dev-audit.txt"

step "Verify PROD Firestore location"
DB_LOCATION="$(gcloud firestore databases describe --project "$PROD_FIREBASE_PROJECT_ID" --database='(default)' --format='value(locationId)')"
test "$DB_LOCATION" = "asia-southeast1" || { echo "BLOCKED: unexpected Firestore location $DB_LOCATION"; exit 1; }
echo "firestoreLocation=$DB_LOCATION" > "$EVIDENCE_DIR/firestore-location.txt"

step "Ensure private PROD backup bucket"
if ! gcloud storage buckets describe "$BACKUP_BUCKET" --project "$PROD_FIREBASE_PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "$BACKUP_BUCKET" \
    --project "$PROD_FIREBASE_PROJECT_ID" \
    --location "$DB_LOCATION" \
    --uniform-bucket-level-access
fi
gcloud storage buckets describe "$BACKUP_BUCKET" --project "$PROD_FIREBASE_PROJECT_ID" --format='yaml(name,location,storageClass,uniformBucketLevelAccess)'> "$EVIDENCE_DIR/backup-bucket.txt"

step "Backup PROD Firestore"
gcloud firestore export "$BACKUP_URI" --project "$PROD_FIREBASE_PROJECT_ID" --database='(default)'
gcloud storage ls "$BACKUP_URI/**" --project "$PROD_FIREBASE_PROJECT_ID" | head -n 30 > "$EVIDENCE_DIR/firestore-backup-objects.txt"
test -s "$EVIDENCE_DIR/firestore-backup-objects.txt" || { echo "BLOCKED: backup produced no objects"; exit 1; }
{
  echo "projectId=$PROD_FIREBASE_PROJECT_ID"
  echo "database=(default)"
  echo "location=$DB_LOCATION"
  echo "backupBucket=$BACKUP_BUCKET"
  echo "backupUri=$BACKUP_URI"
  echo "sourceMainSha=$PROD_BASE_SHA"
  echo "candidateSha=$CANDIDATE_SHA"
} > "$EVIDENCE_DIR/prod-backup-manifest.txt"

step "Live PROD legacy and migration dry-run audit"
export GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)"
node "$CONTROL_DIR/release-tools/prod-live-audit.mjs" "$EVIDENCE_DIR/prod-live-legacy-audit-summary.json"
unset GOOGLE_ACCESS_TOKEN

step "Full dependency security inventory"
cd "$CANDIDATE_DIR"
npm audit --omit=dev --json > "$EVIDENCE_DIR/npm-audit-production.json" || true
node - <<'NODE'
const fs=require('fs');
const p=process.env.GITHUB_WORKSPACE+'/release-evidence/npm-audit-production.json';
const o=process.env.GITHUB_WORKSPACE+'/release-evidence/npm-audit-summary.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const v=j.metadata?.vulnerabilities || {};
const summary={info:v.info||0,low:v.low||0,moderate:v.moderate||0,high:v.high||0,critical:v.critical||0,total:v.total||0};
fs.writeFileSync(o,JSON.stringify(summary,null,2));
console.log('npm audit summary', summary);
if ((summary.critical||0)>0) process.exit(3);
NODE

step "HNL AI deterministic gates"
npm run test:ai-core
npm run test:ai-tools
npm run test:ai-audit
npm run test:ai-planner
npm run test:ai-provider
npm run test:ai-gateway
npm run test:ai-export

step "Full exact-source certification"
npm run verify

step "Certify PROD endpoint isolation in exact bundle"
grep -R -q 'com-example-qlct-61329' dist/assets || { echo 'BLOCKED: PROD Firebase project missing in bundle'; exit 1; }
grep -R -q 'hnl-qltc-r2-gateway.lengochieu1211.workers.dev' dist/assets || { echo 'BLOCKED: PROD R2 gateway missing in bundle'; exit 1; }
grep -R -q 'hnl-qltc-ai-gateway.lengochieu1211.workers.dev' dist/assets || { echo 'BLOCKED: PROD AI gateway missing in bundle'; exit 1; }
if grep -R -q 'hnl-qltc-dev' dist/assets; then echo 'BLOCKED: DEV Firebase/Hosting marker leaked into PROD bundle'; exit 1; fi
if grep -R -q 'hnl-qltc-r2-gateway-dev' dist/assets; then echo 'BLOCKED: DEV R2 gateway leaked into PROD bundle'; exit 1; fi
if grep -R -q 'hnl-qltc-ai-gateway-dev' dist/assets; then echo 'BLOCKED: DEV AI gateway leaked into PROD bundle'; exit 1; fi
echo 'PROD bundle endpoint isolation PASS' > "$EVIDENCE_DIR/prod-endpoint-isolation.txt"

step "Exact candidate local smoke"
python3 -m http.server 4173 -d dist >/tmp/hnl-preflight-http.log 2>&1 &
PID=$!
cleanup_http() { kill "$PID" >/dev/null 2>&1 || true; }
trap cleanup_http EXIT
ok=0
for i in $(seq 1 20); do
  HTML="$(curl --fail --silent --show-error http://127.0.0.1:4173/ || true)"
  if printf '%s' "$HTML" | grep -qi '<div id="root"'; then ok=1; break; fi
  sleep 1
done
test "$ok" = 1 || { cat /tmp/hnl-preflight-http.log; exit 1; }
cleanup_http
trap - EXIT
echo 'Exact candidate local smoke PASS' > "$EVIDENCE_DIR/exact-candidate-smoke.txt"

step "Current PROD pre-deploy smoke"
HTML="$(curl --fail --silent --show-error "${PROD_HOSTING_URL}/?preflight=${GITHUB_RUN_ID}")"
printf '%s' "$HTML" | grep -qi '<div id="root"' || { echo 'BLOCKED: current PROD Hosting unhealthy'; exit 1; }
AI="$(curl --fail --silent --show-error "${PROD_AI_URL}/health?preflight=${GITHUB_RUN_ID}")"
printf '%s' "$AI" | grep -q '"ok":true' || { echo 'BLOCKED: PROD AI health failed'; exit 1; }
printf '%s' "$AI" | grep -q '"environment":"PROD"' || { echo 'BLOCKED: AI endpoint is not PROD'; exit 1; }
printf '%s' "$AI" | grep -q '"firebaseProjectId":"com-example-qlct-61329"' || { echo 'BLOCKED: AI PROD Firebase project mismatch'; exit 1; }
R2_CODE="$(curl -sS -o /tmp/r2-health.txt -w '%{http_code}' "${PROD_R2_URL}/health?preflight=${GITHUB_RUN_ID}" || true)"
if [ "$R2_CODE" = "000" ]; then
  R2_CODE="$(curl -sS -o /tmp/r2-root.txt -w '%{http_code}' "${PROD_R2_URL}/?preflight=${GITHUB_RUN_ID}" || true)"
fi
test "$R2_CODE" != "000" || { echo 'BLOCKED: PROD R2 endpoint unreachable'; exit 1; }
{
  echo 'PROD Hosting pre-deploy smoke PASS'
  echo 'PROD AI pre-deploy smoke PASS'
  echo "PROD R2 endpoint HTTP=$R2_CODE"
} > "$EVIDENCE_DIR/prod-predeploy-smoke.txt"

cat > "$EVIDENCE_DIR/README.md" <<EOF
# HNL QLTC PROD Preflight

- PROD source backup branch: backup/prod-pre-20260916-0952e01c
- PROD base SHA: $PROD_BASE_SHA
- Certified candidate SHA: $CANDIDATE_SHA
- Firebase project: $PROD_FIREBASE_PROJECT_ID
- Hosting: $PROD_HOSTING_URL
- R2: $PROD_R2_URL
- AI: $PROD_AI_URL
- Firestore backup: see prod-backup-manifest.txt (private PROD Google Cloud bucket)
- Raw PROD business data is intentionally NOT uploaded to the GitHub artifact.
- main→candidate audit, live legacy dry-run, full security inventory, source certification, endpoint isolation and smoke all passed.
EOF

step "PROD preflight PASS"
