param(
  [ValidateSet('PROD','DEV')]
  [string]$Channel = 'PROD',
  [string]$LauncherPath = './HNL-QLTC-Windows.exe',
  [string]$OutputPath = ''
)

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

$launcher = (Resolve-Path -LiteralPath $LauncherPath).Path
$releaseTagFile = Join-Path $root 'release-tag.txt'
$releaseTag = if ($env:QLCT_RELEASE_TAG) {
  [string]$env:QLCT_RELEASE_TAG
} elseif (Test-Path -LiteralPath $releaseTagFile) {
  (Get-Content -Raw -LiteralPath $releaseTagFile).Trim()
} else {
  $version
}
if ([string]::IsNullOrWhiteSpace($releaseTag)) { $releaseTag = $version }
if ($releaseTag -match '[\r\n"]') { throw 'Invalid release tag.' }

$isDev = $Channel -eq 'DEV'
$productLabel = if ($isDev) { 'HNL QLTC DEV' } else { 'HNL QLTC' }
$installFolder = if ($isDev) { 'HNL QLTC DEV' } else { 'HNL QLTC' }
$installedExe = if ($isDev) { 'HNL QLTC DEV.exe' } else { 'HNL QLTC.exe' }
$uninstallerExe = if ($isDev) { 'HNL QLTC DEV Uninstall.exe' } else { 'HNL QLTC Uninstall.exe' }
$shortcutName = if ($isDev) { 'HNL QLTC DEV' } else { 'HNL QLTC' }
$registryKey = if ($isDev) { 'HNL QLTC DEV' } else { 'HNL QLTC' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $defaultOutputName = if ($isDev) { 'HNL-QLTC-DEV-Setup.exe' } else { 'HNL-QLTC-Setup.exe' }
  $OutputPath = Join-Path $projectRoot $defaultOutputName
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $projectRoot $OutputPath
}

$parts = $version.Split('.')
$assemblyVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"
$buildInfo = Join-Path $root 'InstallerBuildInfo.generated.cs'
$assemblyInfo = Join-Path $root 'InstallerAssemblyInfo.generated.cs'
$uninstallerTemp = Join-Path $root 'HNL-QLTC-Uninstaller.generated.exe'
$generatedIcon = Join-Path $root 'HNL-QLTC-Setup.generated.ico'
$logoSource = Join-Path $root 'HNL-QLTC-SHELL-ICON.png'
$manifest = Join-Path $root 'HnlQltcInstaller.manifest'

if (-not (Test-Path -LiteralPath $logoSource)) { throw "HNL Windows icon source not found: $logoSource" }
if (-not (Test-Path -LiteralPath $manifest)) { throw "Installer manifest not found: $manifest" }

Add-Type -AssemblyName System.Drawing

function New-HnlPngFrame {
  param([System.Drawing.Image]$Source, [int]$Size)
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $scale = [Math]::Min($Size / [double]$Source.Width, $Size / [double]$Source.Height)
    $drawWidth = [Math]::Max(1, [int][Math]::Round($Source.Width * $scale))
    $drawHeight = [Math]::Max(1, [int][Math]::Round($Source.Height * $scale))
    $x = [int][Math]::Floor(($Size - $drawWidth) / 2.0)
    $y = [int][Math]::Floor(($Size - $drawHeight) / 2.0)
    $graphics.DrawImage($Source, (New-Object System.Drawing.Rectangle($x, $y, $drawWidth, $drawHeight)))
    $stream = New-Object System.IO.MemoryStream
    try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); return $stream.ToArray() }
    finally { $stream.Dispose() }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}


function Write-HnlIcoFromPng {
  param([string]$PngPath, [string]$IcoPath)
  $sizes = @(16,20,24,28,32,40,48,64,80,96,128,256)
  $source = [System.Drawing.Image]::FromFile($PngPath)
  try {
    if ($source.Width -lt 256 -or $source.Height -lt 256) { throw "HNL logo source too small: $($source.Width)x$($source.Height)" }
    $frames = @()
    foreach ($size in $sizes) {
      $frames += ,([PSCustomObject]@{ Size=$size; Bytes=[byte[]](New-HnlPngFrame -Source $source -Size $size) })
    }
    $file = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $writer = New-Object System.IO.BinaryWriter($file)
    try {
      $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$frames.Count)
      [UInt32]$offset = [UInt32](6 + (16 * $frames.Count))
      foreach ($frame in $frames) {
        [byte]$dimension = if ($frame.Size -eq 256) { 0 } else { [byte]$frame.Size }
        $writer.Write($dimension); $writer.Write($dimension); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([UInt16]1); $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frame.Bytes.Length); $writer.Write([UInt32]$offset)
        $offset = [UInt32]($offset + $frame.Bytes.Length)
      }
      foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
    } finally { $writer.Dispose(); $file.Dispose() }
  } finally { $source.Dispose() }
}

@"
namespace HnlQltcSetup
{
    internal static class InstallerBuildInfo
    {
        public const string Channel = "$Channel";
        public const string ProductLabel = "$productLabel";
        public const string ReleaseTag = "$releaseTag";
        public const string InstallFolderName = "$installFolder";
        public const string InstalledExeName = "$installedExe";
        public const string UninstallerExeName = "$uninstallerExe";
        public const string ShortcutName = "$shortcutName";
        public const string RegistryKeyName = "$registryKey";
    }
}
"@ | Set-Content -LiteralPath $buildInfo -Encoding UTF8

@"
using System.Reflection;
[assembly: AssemblyTitle("$productLabel Setup")]
[assembly: AssemblyProduct("$productLabel")]
[assembly: AssemblyCompany("HNL")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$releaseTag")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8

try {
  Write-HnlIcoFromPng -PngPath $logoSource -IcoPath $generatedIcon
  if ((Get-Item -LiteralPath $generatedIcon).Length -lt 20000) { throw 'Certified setup icon is unexpectedly small.' }

  & $csc /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll /win32manifest:"$manifest" /win32icon:"$generatedIcon" /out:"$uninstallerTemp" (Join-Path $root 'HnlQltcUninstaller.cs') $buildInfo $assemblyInfo
  if ($LASTEXITCODE -ne 0) { throw "Uninstaller csc failed: $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $uninstallerTemp)) { throw 'Uninstaller payload was not created.' }

  $launcherResource = "/resource:$launcher,HNL.QLTC.Payload.Launcher"
  $uninstallerResource = "/resource:$uninstallerTemp,HNL.QLTC.Payload.Uninstaller"
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll /win32manifest:"$manifest" /win32icon:"$generatedIcon" $launcherResource $uninstallerResource /out:"$OutputPath" (Join-Path $root 'HnlQltcInstaller.cs') $buildInfo $assemblyInfo
  if ($LASTEXITCODE -ne 0) { throw "Installer csc failed: $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Setup EXE was not created.' }

  $setup = Get-Item -LiteralPath $OutputPath
  if ($setup.Length -le (Get-Item -LiteralPath $launcher).Length) { throw 'Setup EXE does not appear to contain embedded launcher payload.' }
  Write-Host "Setup created: $($setup.FullName)"
  Write-Host "Channel: $Channel"
  Write-Host "Release: $releaseTag"
  Write-Host "Install root: %ProgramFiles%\HNL\$installFolder"
  Write-Host "Installed EXE: $installedExe"
  Write-Host "Desktop/Start Menu shortcut: $shortcutName"
  Write-Host 'User data policy: preserve Documents\HNL QLTC and existing AppData caches on upgrade/uninstall.'
} finally {
  Remove-Item -LiteralPath $buildInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $assemblyInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $uninstallerTemp -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $generatedIcon -Force -ErrorAction SilentlyContinue
}
