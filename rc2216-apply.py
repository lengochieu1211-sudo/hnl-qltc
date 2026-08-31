from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_exact(path, old, new, count=1):
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} occurrence(s), found {actual}: {old[:100]!r}')
    write(path, text.replace(old, new, count))

def replace_version(path):
    text = read(path)
    old = '6.3.0-rc2.2.15'
    if old not in text:
        raise SystemExit(f'{path}: missing old release marker')
    write(path, text.replace(old, '6.3.0-rc2.2.16'))

# Android diagnostics: bypass ACTION_CREATE_DOCUMENT because some providers create a 0-byte file.
replace_exact(
    'src/utils/fileExport.ts',
    "export async function saveJsonRecordFile(data: Record<string, string>, fileName: string) {",
    """// Android WebView: diagnostics/support files must not depend on ACTION_CREATE_DOCUMENT.\n// Some Android document providers create the target entry but leave it at 0 bytes.\n// The native bridge already has a direct Download/QLCT path via finishTextFile().\nexport async function saveTextFileToDownloads(text: string, fileName: string, mimeType = 'application/json;charset=utf-8') {\n  const safeName = sanitizeFileName(fileName);\n  if (hasAndroidTextBridge()) {\n    await saveTextChunksToAndroid(chunkText(text), safeName, mimeType, 'downloads');\n    return;\n  }\n  const blob = new Blob([text], { type: mimeType });\n  await saveBlob(blob, safeName, mimeType);\n}\n\nexport async function saveJsonRecordFile(data: Record<string, string>, fileName: string) {""",
)
replace_exact(
    'src/components/GoogleConfigTab.tsx',
    "import { downloadOrShareFile } from '../utils/downloadUtils';\n",
    "import { downloadOrShareFile } from '../utils/downloadUtils';\nimport { saveTextFileToDownloads } from '../utils/fileExport';\n",
)
replace_exact(
    'src/components/GoogleConfigTab.tsx',
    """      await downloadOrShareFile(`HNL-QLTC-DIAGNOSTIC-${stamp}.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');\n      setSyncMsg('Đã xuất file chẩn đoán lỗi. Có thể gửi file này để kiểm tra lỗi đồng bộ/ảnh/Defect.');""",
    """      const fileName = `HNL-QLTC-DIAGNOSTIC-${stamp}.json`;\n      const jsonText = JSON.stringify(bundle, null, 2);\n      await saveTextFileToDownloads(jsonText, fileName, 'application/json;charset=utf-8');\n      setSyncMsg(typeof window.AndroidExport?.beginTextFile === 'function'\n        ? `Đã lưu ${fileName} vào Download/QLCT.`\n        : 'Đã xuất file chẩn đoán lỗi. Có thể gửi file này để kiểm tra lỗi đồng bộ/ảnh/Defect.');""",
)

# R2 Worker: safe built-in PROD origins, even if a Worker variable is missing/stale.
replace_version('cloudflare/r2-gateway/worker.js')
replace_exact(
    'cloudflare/r2-gateway/worker.js',
    """  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);\n  const allowOrigin = allowed.includes(origin) ? origin : (allowed.includes('*') ? '*' : '');""",
    """  // PROD origins are safe defaults so a missing/stale Worker variable cannot silently\n  // break every browser PUT preflight. Extra origins can still be supplied by Wrangler.\n  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);\n  const allowed = new Set([\n    'https://hnlqltc.web.app',\n    'https://com-example-qlct-61329.web.app',\n    'https://com-example-qlct-61329.firebaseapp.com',\n    ...configured,\n  ]);\n  const allowOrigin = allowed.has(origin) ? origin : (allowed.has('*') ? '*' : '');""",
)

# Golden must reproduce the exact browser PUT preflight that failed on PROD.
replace_version('scripts/r2-gateway-golden.mjs')
replace_exact(
    'scripts/r2-gateway-golden.mjs',
    "assert(health.accessPolicy === 'canonical-email-first', 'gateway health exposes canonical email-first RBAC policy');\n\nconst mediaKey =",
    """assert(health.accessPolicy === 'canonical-email-first', 'gateway health exposes canonical email-first RBAC policy');\n\nconst envWithoutCorsVar = { ...env, ALLOWED_ORIGINS: '' };\nconst preflight = await worker.fetch(new Request('https://gateway.example/v1/object?key=projects/p1/media/diagnostics/probe/original.jpg', {\n  method: 'OPTIONS',\n  headers: {\n    Origin: 'https://hnlqltc.web.app',\n    'Access-Control-Request-Method': 'PUT',\n    'Access-Control-Request-Headers': 'authorization,content-type,x-hnl-metadata',\n  },\n}), envWithoutCorsVar);\nassert(preflight.status === 204, 'PUT browser preflight returns 204');\nassert(preflight.headers.get('Access-Control-Allow-Origin') === 'https://hnlqltc.web.app', 'PROD Hosting origin is allowed even if Worker ALLOWED_ORIGINS variable is missing');\nassert(String(preflight.headers.get('Access-Control-Allow-Methods') || '').includes('PUT'), 'PUT is present in CORS allowed methods');\nassert(String(preflight.headers.get('Access-Control-Allow-Headers') || '').includes('Authorization'), 'Authorization is present in CORS allowed headers');\nassert(String(preflight.headers.get('Access-Control-Allow-Headers') || '').includes('X-HNL-Metadata'), 'X-HNL-Metadata is present in CORS allowed headers');\n\nconst mediaKey =""",
)

# Worker deploy is manual-only and must certify CORS, not just /health.
replace_version('.github/workflows/r2-worker-deploy.yml')
replace_exact(
    '.github/workflows/r2-worker-deploy.yml',
    "          grep -q '\"accessPolicy\":\"canonical-email-first\"' /tmp/r2-health.json\n",
    """          grep -q '\"accessPolicy\":\"canonical-email-first\"' /tmp/r2-health.json\n\n      - name: Smoke browser PUT CORS preflight\n        shell: bash\n        run: |\n          set -euo pipefail\n          BASE='https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev'\n          curl --fail --silent --show-error -X OPTIONS -D /tmp/r2-cors.headers -o /tmp/r2-cors.body \\\n            -H 'Origin: https://hnlqltc.web.app' \\\n            -H 'Access-Control-Request-Method: PUT' \\\n            -H 'Access-Control-Request-Headers: authorization,content-type,x-hnl-metadata' \\\n            \"$BASE/v1/object?key=projects/cors-probe/media/diagnostics/probe/original.jpg\"\n          cat /tmp/r2-cors.headers\n          grep -qi '^access-control-allow-origin: https://hnlqltc.web.app' /tmp/r2-cors.headers\n          grep -qi '^access-control-allow-methods:.*PUT' /tmp/r2-cors.headers\n          grep -qi '^access-control-allow-headers:.*Authorization' /tmp/r2-cors.headers\n          grep -qi '^access-control-allow-headers:.*X-HNL-Metadata' /tmp/r2-cors.headers\n""",
)

# Release markers.
for path in [
    '.github/workflows/android-apk.yml',
    '.github/workflows/windows-exe.yml',
    'desktop-wrapper/release-tag.txt',
    'scripts/desktop-launcher-golden.mjs',
]:
    replace_version(path)

# Stability guards: lock both discovered root causes against regression.
replace_version('scripts/stability-gate.mjs')
replace_exact(
    'scripts/stability-gate.mjs',
    "const runtimeDiagnostics = read('src/lib/runtimeDiagnostics.ts');\n",
    "const runtimeDiagnostics = read('src/lib/runtimeDiagnostics.ts');\nconst fileExport = read('src/utils/fileExport.ts');\n",
)
replace_exact(
    'scripts/stability-gate.mjs',
    "requireAll(configTab, ['Hệ thống & Chẩn đoán', 'Xuất file chẩn đoán lỗi', 'getProjectPhotoDiagnosticSnapshot', 'clearRuntimeDiagnostics'], 'system diagnostics can export sanitized JSON with photo evidence');",
    """requireAll(configTab, ['Hệ thống & Chẩn đoán', 'Xuất file chẩn đoán lỗi', 'getProjectPhotoDiagnosticSnapshot', 'clearRuntimeDiagnostics', 'saveTextFileToDownloads', 'Download/QLCT'], 'system diagnostics can export sanitized non-empty Android JSON with photo evidence');\nrequireAll(fileExport, ['saveTextFileToDownloads', \"'downloads'\", 'finishTextFile'], 'Android diagnostics direct Download/QLCT export avoids zero-byte picker provider');""",
)
replace_exact(
    'scripts/stability-gate.mjs',
    "requireAll(r2Worker, [\"request.method === 'HEAD'\", 'HNL_QLTC_MEDIA.head', 'X-HNL-SHA256', 'Content-Length', \"GATEWAY_VERSION = '6.3.0-rc2.2.16'\", \"accessPolicy: 'canonical-email-first'\", \"for (const memberId of [email, uid])\"], 'R2 gateway durable object HEAD + canonical cross-account RBAC/version');",
    "requireAll(r2Worker, [\"request.method === 'HEAD'\", 'HNL_QLTC_MEDIA.head', 'X-HNL-SHA256', 'Content-Length', \"GATEWAY_VERSION = '6.3.0-rc2.2.16'\", \"accessPolicy: 'canonical-email-first'\", \"for (const memberId of [email, uid])\", \"'https://hnlqltc.web.app'\", 'Access-Control-Allow-Methods'], 'R2 gateway durable object HEAD + canonical cross-account RBAC/version/CORS defaults');",
)
replace_exact(
    'scripts/stability-gate.mjs',
    "requireAll(r2DeployWorkflow, ['workflow_dispatch:', 'DEPLOY-R2', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'wrangler@4.33.0 deploy', '/health', '\"version\":\"6.3.0-rc2.2.16\"', '\"accessPolicy\":\"canonical-email-first\"'], 'manual-gated R2 Worker deploy workflow + exact runtime verification');",
    "requireAll(r2DeployWorkflow, ['workflow_dispatch:', 'DEPLOY-R2', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'wrangler@4.33.0 deploy', '/health', '\"version\":\"6.3.0-rc2.2.16\"', '\"accessPolicy\":\"canonical-email-first\"', 'Smoke browser PUT CORS preflight', 'Access-Control-Request-Method: PUT'], 'manual-gated R2 Worker deploy workflow + exact runtime/CORS verification');",
)

print('RC2.2.16 exact transformations applied')
