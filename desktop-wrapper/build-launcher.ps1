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
if (-not $csc) { throw 'C# compiler csc.exe not found. Windows 10/11 with .NET Framework 4.x is required.' }

$releaseTagFile = Join-Path $root 'release-tag.txt'
$releaseTag = if ($env:QLCT_RELEASE_TAG) {
  [string]$env:QLCT_RELEASE_TAG
} elseif (Test-Path -LiteralPath $releaseTagFile) {
  (Get-Content -Raw -LiteralPath $releaseTagFile).Trim()
} else {
  $version
}
if ([string]::IsNullOrWhiteSpace($releaseTag)) { $releaseTag = $version }
if ($releaseTag -match '[\r\n\"]') { throw 'Invalid release tag.' }

$assemblyInfo = Join-Path $root 'AssemblyInfo.generated.cs'
$releaseInfo = Join-Path $root 'ReleaseInfo.generated.cs'
$parts = $version.Split('.')
$assemblyVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"
@"
using System.Reflection;
[assembly: AssemblyTitle("HNL Quản Lý Thi Công")]
[assembly: AssemblyProduct("HNL Quản Lý Thi Công")]
[assembly: AssemblyCompany("HNL")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$releaseTag")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8

@"
namespace QLTCAnPhu
{
    internal static class BuildInfo
    {
        public const string ReleaseTag = "$releaseTag";
    }
}
"@ | Set-Content -LiteralPath $releaseInfo -Encoding UTF8

$out = Join-Path $projectRoot 'HNL-QLTC-Windows.exe'
$icon = Join-Path $root 'QLTCAnPhu.ico'
try {
  & $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.dll /win32icon:"$icon" /out:"$out" (Join-Path $root 'QLTCAnPhuLauncher.cs') $assemblyInfo $releaseInfo
  if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $out)) { throw 'Desktop EXE was not created.' }
  Write-Output "Desktop launcher created: $out"
  Write-Output "Version: $version"
  Write-Output "Release tag: $releaseTag"
  Write-Output "Production URL: https://hnlqltc.web.app/?app=desktop&v=$releaseTag"
} finally {
  Remove-Item -LiteralPath $assemblyInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $releaseInfo -Force -ErrorAction SilentlyContinue
}
