param(
  [string]$ExePath = './HNL-QLTC-Windows.exe',
  [string]$SourcePng = './public/icon.png',
  [string]$EvidenceDir = './icon-golden-evidence'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HnlIconNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(
    string fileName, int iconIndex, int cxIcon, int cyIcon,
    IntPtr[] icons, uint[] iconIds, uint iconCount, uint flags);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
'@

function Assert-Hnl([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "WINDOWS ICON GOLDEN FAIL: $Message" }
  Write-Host "PASS ICON: $Message"
}

$requiredSizes = @(16,20,24,28,32,40,48,64,80,96,128,256)
$runtimeSizes = @(16,20,24,28,32,40,48)
$exe = Resolve-Path -LiteralPath $ExePath
$source = Resolve-Path -LiteralPath $SourcePng
$indexHtml = Get-Content -Raw -LiteralPath './index.html'
$manifestJson = Get-Content -Raw -LiteralPath './public/manifest.json'
Assert-Hnl (-not ($indexHtml -match 'icon-taskbar\.svg')) 'runtime Web no longer asks Chrome/Edge to downsample the vector icon'
Assert-Hnl (-not ($manifestJson -match 'icon-taskbar\.svg')) 'manifest no longer prioritizes the vector runtime icon'
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$runtimeFrames = @()
foreach ($size in $runtimeSizes) {
  $runtimePath = Resolve-Path -LiteralPath ("./public/hnl-logo-original-{0}.png" -f $size)
  Assert-Hnl ($indexHtml -match ("hnl-logo-original-{0}\.png\?v=20260909-original1" -f $size)) "HTML advertises exact ${size}x${size} browser runtime frame"
  Assert-Hnl ($manifestJson -match ("hnl-logo-original-{0}\.png\?v=20260909-original1" -f $size)) "manifest advertises exact ${size}x${size} browser runtime frame"
  $bmp = [System.Drawing.Bitmap]::FromFile($runtimePath)
  try {
    Assert-Hnl ($bmp.Width -eq $size -and $bmp.Height -eq $size) "runtime PNG is exactly ${size}x${size}"
    $partialAlpha = 0
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $c = $bmp.GetPixel($x,$y)
        if ($c.A -ne 0 -and $c.A -ne 255) { $partialAlpha++ }
        [void]$colors.Add($c.ToArgb())
      }
    }
    Assert-Hnl ($partialAlpha -gt 0) "${size}x${size} runtime frame preserves original-logo anti-aliased edges ($partialAlpha partial-alpha pixels)"
    Assert-Hnl ($colors.Count -ge 16) "${size}x${size} runtime frame preserves original-logo color/detail ($($colors.Count) colors)"
    $copyPath = Join-Path $EvidenceDir ("runtime-frame-{0}.png" -f $size)
    $bmp.Save($copyPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $runtimeFrames += [PSCustomObject]@{ Size=$size; File=$copyPath }
  } finally { $bmp.Dispose() }
}

$sourceImage = [System.Drawing.Image]::FromFile($source)
try {
  Assert-Hnl ($sourceImage.Width -ge 1024 -and $sourceImage.Height -ge 1024) "canonical logo source is at least 1024x1024 ($($sourceImage.Width)x$($sourceImage.Height))"
} finally { $sourceImage.Dispose() }

$availableGroups = [HnlIconNative]::PrivateExtractIcons($exe.Path, -1, 0, 0, $null, $null, 0, 0)
Assert-Hnl ($availableGroups -ge 1) "EXE exposes at least one embedded icon group ($availableGroups)"

$frames = @()
foreach ($size in $requiredSizes) {
  $handles = New-Object IntPtr[] 1
  $ids = New-Object uint32[] 1
  $count = [HnlIconNative]::PrivateExtractIcons($exe.Path, 0, $size, $size, $handles, $ids, 1, 0)
  Assert-Hnl ($count -eq 1 -and $handles[0] -ne [IntPtr]::Zero) "Windows extracts ${size}x${size} icon from EXE"
  try {
    $icon = [System.Drawing.Icon]::FromHandle($handles[0])
    $bmp = $icon.ToBitmap()
    try {
      Assert-Hnl ($bmp.Width -eq $size -and $bmp.Height -eq $size) "EXE icon renders at requested ${size}x${size}"
      $visible = 0
      $colors = New-Object 'System.Collections.Generic.HashSet[int]'
      $step = [Math]::Max(1, [int][Math]::Floor($size / 16))
      for ($y = 0; $y -lt $size; $y += $step) {
        for ($x = 0; $x -lt $size; $x += $step) {
          $c = $bmp.GetPixel($x,$y)
          if ($c.A -gt 0) { $visible++ }
          [void]$colors.Add($c.ToArgb())
        }
      }
      Assert-Hnl ($visible -gt 0) "${size}x${size} icon contains visible pixels"
      Assert-Hnl ($colors.Count -ge 5) "${size}x${size} icon retains visual detail ($($colors.Count) sampled colors)"
      $frameFile = Join-Path $EvidenceDir ("exe-frame-{0}.png" -f $size)
      $bmp.Save($frameFile, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames += [PSCustomObject]@{ Size=$size; File=$frameFile }
    } finally {
      $bmp.Dispose()
      $icon.Dispose()
    }
  } finally {
    [void][HnlIconNative]::DestroyIcon($handles[0])
  }
}

$cellW = 300
$cellH = 330
$columns = 4
$rows = [int][Math]::Ceiling($frames.Count / [double]$columns)
$sheetWidth = [int]($cellW * $columns)
$sheetHeight = [int]($cellH * $rows)
$sheet = [System.Drawing.Bitmap]::new($sheetWidth, $sheetHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
try {
  $g.Clear([System.Drawing.Color]::FromArgb(28,32,40))
  for ($i=0; $i -lt $frames.Count; $i++) {
    $frame = $frames[$i]
    $img = [System.Drawing.Image]::FromFile($frame.File)
    try {
      $col=$i%$columns; $row=[int][Math]::Floor($i/$columns)
      $draw=[Math]::Min(256,[Math]::Max(64,$frame.Size))
      $x=($col*$cellW)+[int](($cellW-$draw)/2); $y=($row*$cellH)+36
      $g.DrawImage($img,$x,$y,$draw,$draw)
      $label="{0}x{0}" -f $frame.Size
      $m=$g.MeasureString($label,$font)
      $g.DrawString($label,$font,[System.Drawing.Brushes]::White,($col*$cellW)+(($cellW-$m.Width)/2),($row*$cellH)+292)
    } finally { $img.Dispose() }
  }
  $sheet.Save((Join-Path $EvidenceDir 'icon-contact-sheet.png'),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $font.Dispose(); $g.Dispose(); $sheet.Dispose()
}

$runtimeSheet = [System.Drawing.Bitmap]::new(720, 180, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$rg = [System.Drawing.Graphics]::FromImage($runtimeSheet)
$rfont = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
try {
  $rg.Clear([System.Drawing.Color]::FromArgb(232,236,242))
  $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  for ($i=0; $i -lt $runtimeFrames.Count; $i++) {
    $frame = $runtimeFrames[$i]
    $img = [System.Drawing.Image]::FromFile($frame.File)
    try {
      $x = 15 + ($i * 116)
      $rg.DrawImage($img,$x,20,96,96)
      $label = "{0}x{0}" -f $frame.Size
      $rg.DrawString($label,$rfont,[System.Drawing.Brushes]::Black,$x+25,128)
    } finally { $img.Dispose() }
  }
  $runtimeSheet.Save((Join-Path $EvidenceDir 'runtime-original-logo-contact-sheet.png'),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $rfont.Dispose(); $rg.Dispose(); $runtimeSheet.Dispose()
}

@(
  'WINDOWS ICON GOLDEN PASS',
  "EXE=$($exe.Path)",
  "SOURCE=$($source.Path)",
  "ICON_GROUPS=$availableGroups",
  "EXTRACTED_SIZES=$($requiredSizes -join ',')",
  "RUNTIME_ORIGINAL_LOGO_SIZES=$($runtimeSizes -join ',')",
  'CONTACT_SHEET=icon-contact-sheet.png',
  'RUNTIME_ORIGINAL_LOGO_CONTACT_SHEET=runtime-original-logo-contact-sheet.png'
) | Set-Content -LiteralPath (Join-Path $EvidenceDir 'windows-icon-golden.txt') -Encoding UTF8

Write-Host 'WINDOWS ICON GOLDEN PASS'
