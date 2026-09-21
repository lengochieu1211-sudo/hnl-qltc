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
$generatedIcon = Join-Path $root 'HNL-QLTC.generated.ico'
$logoSource = Join-Path $root 'HNL-QLTC-SHELL-ICON.png'
$parts = $version.Split('.')
$assemblyVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"


$webViewVersionFile = Join-Path $root 'webview2-sdk-version.txt'
if (-not (Test-Path -LiteralPath $webViewVersionFile)) { throw "Missing WebView2 SDK version pin: $webViewVersionFile" }
$webViewVersion = (Get-Content -Raw -LiteralPath $webViewVersionFile).Trim()
if ($webViewVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Invalid WebView2 SDK version: $webViewVersion" }
$webViewCache = Join-Path $root ".webview2-sdk-$webViewVersion"
$webViewPackage = Join-Path $root "Microsoft.Web.WebView2.$webViewVersion.nupkg"
$webViewExtract = Join-Path $webViewCache 'package'

function Get-WebView2SdkPayload {
  if (-not (Test-Path -LiteralPath $webViewExtract)) {
    Remove-Item -LiteralPath $webViewCache -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $webViewExtract -Force | Out-Null
    $url = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$webViewVersion"
    Write-Output "Downloading pinned Microsoft.Web.WebView2 SDK $webViewVersion..."
    Invoke-WebRequest -Uri $url -OutFile $webViewPackage -UseBasicParsing
    Expand-Archive -LiteralPath $webViewPackage -DestinationPath $webViewExtract -Force
  }

  $core = Get-ChildItem -LiteralPath $webViewExtract -Recurse -File -Filter 'Microsoft.Web.WebView2.Core.dll' |
    Where-Object { $_.FullName -match '[\\/]lib[\\/]net462[\\/]' } | Select-Object -First 1
  $winForms = Get-ChildItem -LiteralPath $webViewExtract -Recurse -File -Filter 'Microsoft.Web.WebView2.WinForms.dll' |
    Where-Object { $_.FullName -match '[\\/]lib[\\/]net462[\\/]' } | Select-Object -First 1
  $loaderX64 = Get-ChildItem -LiteralPath $webViewExtract -Recurse -File -Filter 'WebView2Loader.dll' |
    Where-Object { $_.FullName -match '([\\/]x64[\\/]|[\\/]win-x64[\\/])' } | Select-Object -First 1
  $loaderX86 = Get-ChildItem -LiteralPath $webViewExtract -Recurse -File -Filter 'WebView2Loader.dll' |
    Where-Object { $_.FullName -match '([\\/]x86[\\/]|[\\/]win-x86[\\/])' } | Select-Object -First 1

  if (-not $core) { throw 'WebView2 Core managed assembly not found in pinned NuGet package.' }
  if (-not $winForms) { throw 'WebView2 WinForms managed assembly not found in pinned NuGet package.' }
  if (-not $loaderX64) { throw 'WebView2 x64 loader not found in pinned NuGet package.' }
  if (-not $loaderX86) { throw 'WebView2 x86 loader not found in pinned NuGet package.' }

  return [PSCustomObject]@{
    Core = $core.FullName
    WinForms = $winForms.FullName
    LoaderX64 = $loaderX64.FullName
    LoaderX86 = $loaderX86.FullName
  }
}

if (-not (Test-Path -LiteralPath $logoSource)) {
  throw "Certified HNL Windows icon source was not found: $logoSource"
}

Add-Type -AssemblyName System.Drawing

function New-HnlPngFrame {
  param(
    [Parameter(Mandatory = $true)] [System.Drawing.Image] $Source,
    [Parameter(Mandatory = $true)] [int] $Size
  )

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
    $dest = New-Object System.Drawing.Rectangle($x, $y, $drawWidth, $drawHeight)
    $graphics.DrawImage($Source, $dest)

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      return $stream.ToArray()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}


function Write-HnlIcoFromPng {
  param(
    [Parameter(Mandatory = $true)] [string] $PngPath,
    [Parameter(Mandatory = $true)] [string] $IcoPath
  )

  # Windows uses a maximum 256x256 icon frame. Explicit smaller frames avoid
  # Explorer/desktop scaling a single tiny image, which caused the old blurry EXE icon.
  $sizes = @(16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 256)
  $source = [System.Drawing.Image]::FromFile($PngPath)
  try {
    if ($source.Width -lt 256 -or $source.Height -lt 256) {
      throw "HNL logo source is too small for Windows icon generation: $($source.Width)x$($source.Height)"
    }

    $frames = @()
    foreach ($size in $sizes) {
      $frames += ,([PSCustomObject]@{
        Size = $size
        Bytes = [byte[]](New-HnlPngFrame -Source $source -Size $size)
      })
    }

    $file = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $writer = New-Object System.IO.BinaryWriter($file)
    try {
      $writer.Write([UInt16]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]$frames.Count)

      [UInt32]$offset = [UInt32](6 + (16 * $frames.Count))
      foreach ($frame in $frames) {
        [byte]$dimension = if ($frame.Size -eq 256) { 0 } else { [byte]$frame.Size }
        $writer.Write($dimension)
        $writer.Write($dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frame.Bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset = [UInt32]($offset + $frame.Bytes.Length)
      }

      foreach ($frame in $frames) {
        $writer.Write([byte[]]$frame.Bytes)
      }
    } finally {
      $writer.Dispose()
      $file.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

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
try {
  Write-HnlIcoFromPng -PngPath $logoSource -IcoPath $generatedIcon
  $iconBytes = (Get-Item -LiteralPath $generatedIcon).Length
  if ($iconBytes -lt 20000) { throw "Certified ICO is unexpectedly small: $iconBytes bytes" }

  $webView = Get-WebView2SdkPayload
  $desktopSources = @((Join-Path $root 'QLTCAnPhuLauncher.cs'), (Join-Path $root 'DesktopLocalStore.cs'), (Join-Path $root 'DesktopSyncCenterForm.cs'), (Join-Path $root 'DesktopWebShellForm.cs'))
  $resourceCore = '/resource:' + $webView.Core + ',HNL.QLTC.WebView2.Core'
  $resourceWinForms = '/resource:' + $webView.WinForms + ',HNL.QLTC.WebView2.WinForms'
  $resourceLoaderX64 = '/resource:' + $webView.LoaderX64 + ',HNL.QLTC.WebView2.Loader.x64'
  $resourceLoaderX86 = '/resource:' + $webView.LoaderX86 + ',HNL.QLTC.WebView2.Loader.x86'
  & $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll /reference:System.Core.dll /win32icon:"$generatedIcon" /out:"$out" $resourceCore $resourceWinForms $resourceLoaderX64 $resourceLoaderX86 $desktopSources $assemblyInfo $releaseInfo
  if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $out)) { throw 'Desktop EXE was not created.' }

  Write-Output "Desktop launcher created: $out"
  Write-Output "Version: $version"
  Write-Output "Release tag: $releaseTag"
  Write-Output "Production URL: https://hnlqltc.web.app/?app=desktop&v=$releaseTag"
  Write-Output "Icon source: desktop-wrapper/HNL-QLTC-SHELL-ICON.png ($((Get-Item -LiteralPath $logoSource).Length) bytes)"
  Write-Output "Certified multi-resolution ICO: $iconBytes bytes (generated from the dedicated user-provided HNL shell icon artwork)"
  Write-Output "Embedded WebView2 SDK: $webViewVersion (Core + WinForms + x64/x86 loader embedded into the EXE)"
} finally {
  Remove-Item -LiteralPath $assemblyInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $releaseInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $generatedIcon -Force -ErrorAction SilentlyContinue
}
