$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$pkg = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = [string]$pkg.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid package version: $version" }

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'C# compiler csc.exe not found.' }

$generated = Join-Path $root 'AssemblyInfo.generated.cs'
$parts = $version.Split('.')
$assemblyVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"
@"
using System.Reflection;
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $generated -Encoding UTF8

$out = Join-Path $projectRoot 'HNL Quản Lý Thi Công.exe'
$icon = Join-Path $root 'QLTCAnPhu.ico'
try {
  & $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.dll /win32icon:"$icon" /out:"$out" (Join-Path $root 'QLTCAnPhuLauncher.cs') $generated
  if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
  Write-Output "Desktop launcher created: $out (version $version)"
} finally {
  Remove-Item -LiteralPath $generated -Force -ErrorAction SilentlyContinue
}
