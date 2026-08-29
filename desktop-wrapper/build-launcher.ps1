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
$logoSource = Join-Path $projectRoot 'public\icon.png'
$parts = $version.Split('.')
$assemblyVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"

if (-not (Test-Path -LiteralPath $logoSource)) {
  throw "High-resolution HNL logo source was not found: $logoSource"
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
  $sizes = @(16, 24, 32, 48, 64, 96, 128, 256)
  $source = [System.Drawing.Image]::FromFile($PngPath)
  try {
    if ($source.Width -lt 1024 -or $source.Height -lt 1024) {
      throw "HNL logo source is too small for HQ icon generation: $($source.Width)x$($source.Height)"
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
  if ($iconBytes -lt 20000) { throw "Generated ICO is unexpectedly small: $iconBytes bytes" }

  & $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.dll /win32icon:"$generatedIcon" /out:"$out" (Join-Path $root 'QLTCAnPhuLauncher.cs') $assemblyInfo $releaseInfo
  if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $out)) { throw 'Desktop EXE was not created.' }

  Write-Output "Desktop launcher created: $out"
  Write-Output "Version: $version"
  Write-Output "Release tag: $releaseTag"
  Write-Output "Production URL: https://hnlqltc.web.app/?app=desktop&v=$releaseTag"
  Write-Output "Icon source: public/icon.png ($((Get-Item -LiteralPath $logoSource).Length) bytes)"
  Write-Output "Generated multi-resolution ICO: $iconBytes bytes (16,24,32,48,64,96,128,256)"
} finally {
  Remove-Item -LiteralPath $assemblyInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $releaseInfo -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $generatedIcon -Force -ErrorAction SilentlyContinue
}
