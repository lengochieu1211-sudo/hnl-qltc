$ErrorActionPreference = 'Stop'
if ($env:QA_PR492_NATIVE_ONLY -ne 'true' -or $env:GITHUB_REF -ne 'refs/heads/qa/pr492-stage3-isolated-20261124' -or -not $env:RUNNER_TEMP) { throw 'QA hosted runner only' }
if ($env:VITE_APP_ENV -ne 'DEV' -or $env:VITE_USE_FIREBASE_EMULATORS -ne 'true' -or $env:VITE_FIREBASE_EMULATOR_PROJECT_ID -ne 'demo-hnl-qltc-pr492' -or $env:VITE_FIREBASE_EMULATOR_HOST -ne '127.0.0.1') { throw 'Emulator boundary missing' }
foreach ($key in @('GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','CLOUDFLARE_API_TOKEN','QLCT_ANDROID_KEYSTORE_BASE64','QLCT_ANDROID_KEYSTORE_PASSWORD','QLCT_ANDROID_KEY_PASSWORD','QLCT_ANDROID_KEY_ALIAS')) {
  if ([Environment]::GetEnvironmentVariable($key)) { throw "Unexpected credential: $key" }
}
$repo = (Get-Location).Path
$evidence = Join-Path $repo 'qa-native-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$work = Join-Path $env:RUNNER_TEMP ('hnl-pr492-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
$archive = Join-Path $work 'source.zip'
git archive --format=zip -o $archive HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive $archive (Join-Path $work 'source')
Set-Location (Join-Path $work 'source')
function Rewrite([string]$path,[string]$from,[string]$to) {
  $s = Get-Content -Raw -LiteralPath $path
  if (-not $s.Contains($from)) { throw "Expected isolation anchor missing: $path" }
  [IO.File]::WriteAllText((Resolve-Path $path).Path,$s.Replace($from,$to),[Text.UTF8Encoding]::new($false))
}
$server=$null
try {
  git -C $repo rev-parse HEAD | Set-Content (Join-Path $evidence 'HEAD.txt')
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'emulator bundle build failed' }
  # Only the disposable archive is rewritten; tracked release wrappers stay identical.
  $launcher='desktop-wrapper/QLTCAnPhuLauncher.cs'
  $shell='desktop-wrapper/DesktopWebShellForm.cs'
  Rewrite $launcher 'https://hnlqltc.web.app/?app=desktop' 'http://127.0.0.1:4178/?app=desktop&env=dev'
  Rewrite $launcher 'https://hnlqltc.web.app/' 'http://127.0.0.1:4178/'
  Rewrite $launcher 'https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev/health' 'http://127.0.0.1:4178/health'
  Rewrite $launcher 'https://hnl-qltc-ai-gateway.lengochieu1211.workers.dev/health' 'http://127.0.0.1:4178/health'
  Rewrite $launcher '"QLTCAnPhu"' '"QLTCAnPhuQA_PR492"'
  Rewrite $launcher '"HNL QLTC"' '"HNL QLTC QA PR492"'
  Rewrite $launcher '"HNL QLTC DEV"' '"HNL QLTC QA PR492"'
  Rewrite $shell '"QLTCAnPhu"' '"QLTCAnPhuQA_PR492"'
  Rewrite $shell 'return scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob";' 'return (scheme == "http" && parsed.Host == "127.0.0.1" && (parsed.Port == 4178 || parsed.Port == 9099 || parsed.Port == 8080 || parsed.Port == 9199)) || scheme == "about" || scheme == "data" || scheme == "blob";'
  Rewrite 'scripts/windows-webview2-runtime-golden.ps1' 'QLTCAnPhu\WebView2Bridge' 'QLTCAnPhuQA_PR492\WebView2Bridge'
  if ((Get-Content -Raw $launcher) -match 'https://hnlqltc\.web\.app|workers\.dev|"QLTCAnPhu"') { throw 'Live native endpoint/profile remains' }
  & ./desktop-wrapper/build-launcher.ps1
  if (-not (Test-Path './HNL-QLTC-Windows.exe')) { throw 'EXE missing' }
  Copy-Item './HNL-QLTC-Windows.exe' (Join-Path $evidence 'HNL-QLTC-QA-PR492-Windows.exe')
  & ./scripts/windows-desktop-local-store-golden.ps1
  # A static local fixture deliberately contains no Firebase or external resource.
  # It verifies the actual EXE shell, embedded popup, and download routing only.
  $fixture = Join-Path $work 'fixture.cjs'
  @'
const http=require('node:http');http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; object-src 'none'; connect-src 'none'"});r.end('<!doctype html><title>QA PR492 loopback only</title><h1>QA PR492 native shell fixture</h1>')}).listen(4178,'127.0.0.1');
'@ | Set-Content -LiteralPath $fixture -Encoding utf8
  $server=Start-Process node -ArgumentList ('"'+$fixture+'"') -PassThru
  for($i=0;$i -lt 20;$i++){try{if((Invoke-WebRequest 'http://127.0.0.1:4178/' -TimeoutSec 2).StatusCode -eq 200){break}}catch{Start-Sleep -Seconds 1}}
  & ./scripts/windows-webview2-runtime-golden.ps1 -LauncherPath './HNL-QLTC-Windows.exe' -Channel DEV
  Copy-Item './webview2-runtime-evidence' $evidence -Recurse
  Stop-Process -Id $server.Id -Force; $server=$null
  # Independent Android package and provider; no production signing or installer.
  Rewrite 'android-wrapper/AndroidManifest.xml' 'com.qlct.app' 'com.qlct.app.qa.pr492'
  Rewrite 'android-wrapper/AndroidManifest.xml' 'android:usesCleartextTraffic="false"' 'android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/qa_network_security"'
  New-Item -ItemType Directory -Force 'android-wrapper/res/xml' | Out-Null
  @'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false"/>
  <domain-config cleartextTrafficPermitted="true"><domain>127.0.0.1</domain></domain-config>
</network-security-config>
'@ | Set-Content 'android-wrapper/res/xml/qa_network_security.xml' -Encoding utf8
  Get-ChildItem 'android-wrapper/src' -Recurse -Filter '*.java' | ForEach-Object { Rewrite $_.FullName 'com.qlct.app' 'com.qlct.app.qa.pr492' }
  $java='android-wrapper/src/com/qlct/app/MainActivity.java'
  Rewrite $java 'return LOCAL_FALLBACK_URL;' 'return "http://127.0.0.1:4178/?app=android&env=dev";'
  Rewrite $java 'webView.loadUrl(LOCAL_FALLBACK_URL);' 'webView.loadUrl("about:blank");'
  Rewrite $java 'private boolean handleUrlOverride(String url) {' 'private boolean handleUrlOverride(String url) { if (url == null) return true; Uri qa = Uri.parse(url); if ("http".equals(qa.getScheme()) && "127.0.0.1".equals(qa.getHost()) && (qa.getPort() == 4178 || qa.getPort() == 8080 || qa.getPort() == 9099 || qa.getPort() == 9199)) return false; if ("about".equals(qa.getScheme()) || "blob".equals(qa.getScheme()) || "data".equals(qa.getScheme())) return false; if (true) return true;'
  Rewrite $java 'return new WebViewClient() {' 'return new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost()) && (u.getPort() == 4178 || u.getPort() == 8080 || u.getPort() == 9099 || u.getPort() == 9199)) return null;
                if ("about".equals(u.getScheme()) || "blob".equals(u.getScheme()) || "data".equals(u.getScheme())) return null;
                return new android.webkit.WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
            }'
  Rewrite 'android-wrapper/build-apk.ps1' "if (`$webUrl -notmatch '^https://') { throw 'QLCT_WEB_URL must use https://' }" "if (`$webUrl -notmatch '^http://127\.0\.0\.1:4178/') { throw 'QA loopback URL required' }"
  Rewrite 'android-wrapper/build-apk.ps1' "'HNL QLTC DEV'" "'HNL QLTC QA PR492'"
  if (Test-Path 'android-wrapper/qlct-debug.keystore') { throw 'Unexpected preexisting signing key' }
  $env:QLCT_WEB_URL='http://127.0.0.1:4178/?app=android&env=dev'
  & ./android-wrapper/build-apk.ps1
  if (-not (Test-Path './HNL-QLTC-Android.apk')) { throw 'APK missing' }
  $manifest=Get-Content -Raw 'android-wrapper/AndroidManifest.xml'
  if ($manifest -notmatch 'package="com\.qlct\.app\.qa\.pr492"' -or $manifest -notmatch 'authorities="com\.qlct\.app\.qa\.pr492\.picker"') { throw 'APK identity isolation failed' }
  if ((Get-Content -Raw 'android-wrapper/res/values/strings.xml') -notmatch 'http://127\.0\.0\.1:4178/') { throw 'APK endpoint mismatch' }
  Copy-Item './HNL-QLTC-Android.apk' (Join-Path $evidence 'HNL-QLTC-QA-PR492-Android.apk')
  Get-ChildItem $evidence -File | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize | Out-String -Width 250 | Set-Content (Join-Path $evidence 'SHA256.txt')
  'Windows native shell probe PASS (local static fixture); SQLite test PASS; APK build PASS; Android runtime and actual authenticated app in native wrappers NOT TESTED. Disposable signing key not exported.' | Set-Content (Join-Path $evidence 'SCOPE.txt')
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Set-Location $repo
}
