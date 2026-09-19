param(
  [Parameter(Mandatory = $true)] [string] $LauncherPath,
  [ValidateSet('PROD','DEV')] [string] $Channel = 'PROD'
)

$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path -LiteralPath $LauncherPath).Path
$evidence = Join-Path (Get-Location) 'webview2-runtime-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$marker = Join-Path $evidence ("webview2-$($Channel.ToLowerInvariant())-status.txt")
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue

$env:HNL_QLTC_WEBVIEW2_SMOKE_FILE = $marker
$process = $null
try {
  $process = Start-Process -FilePath $launcher -PassThru
  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "Desktop EXE exited before WebView2 became ready. ExitCode=$($process.ExitCode)"
    }
    if (Test-Path -LiteralPath $marker) {
      $status = (Get-Content -Raw -LiteralPath $marker).Trim()
      Write-Host "WebView2 smoke marker: $status"
      if ($status.StartsWith('FAIL|')) { throw "Embedded WebView2 initialization failed: $status" }
      if ($status.StartsWith('READY|')) { break }
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-Path -LiteralPath $marker)) { throw 'Timed out waiting for embedded WebView2 READY marker.' }
  $final = (Get-Content -Raw -LiteralPath $marker).Trim()
  if (-not $final.StartsWith('READY|')) { throw "Unexpected WebView2 marker: $final" }

  $bridgeRoot = Join-Path $env:LOCALAPPDATA 'QLTCAnPhu\WebView2Bridge'
  $core = Get-ChildItem -LiteralPath $bridgeRoot -Recurse -File -Filter 'Microsoft.Web.WebView2.Core.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  $winForms = Get-ChildItem -LiteralPath $bridgeRoot -Recurse -File -Filter 'Microsoft.Web.WebView2.WinForms.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  $loader = Get-ChildItem -LiteralPath $bridgeRoot -Recurse -File -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $core -or -not $winForms -or -not $loader) { throw 'Embedded WebView2 payload was not extracted from the single EXE.' }

  Copy-Item -LiteralPath $marker -Destination (Join-Path $evidence 'status.txt') -Force
  @(
    "Launcher=$launcher",
    "Channel=$Channel",
    "Core=$($core.FullName)",
    "WinForms=$($winForms.FullName)",
    "Loader=$($loader.FullName)"
  ) | Set-Content -LiteralPath (Join-Path $evidence 'payload-paths.txt') -Encoding UTF8

  Write-Host 'WINDOWS EMBEDDED WEBVIEW2 RUNTIME GOLDEN PASS'
}
finally {
  Remove-Item Env:HNL_QLTC_WEBVIEW2_SMOKE_FILE -ErrorAction SilentlyContinue
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    try { $process.WaitForExit(5000) } catch { }
  }
}
