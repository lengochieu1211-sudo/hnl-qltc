param(
  [string]$ExePath = './HNL-QLTC-Windows.exe',
  [string]$IcoPath = './HNL-QLTC-Windows.ico',
  [string]$SourcePng = './public/icon.png',
  [string]$EvidenceDir = './icon-golden-evidence'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Assert-Hnl {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "WINDOWS ICON GOLDEN FAIL: $Message" }
  Write-Host "PASS ICON: $Message"
}

$requiredSizes = @(16,20,24,28,32,40,48,64,80,96,128,256)
$exe = Resolve-Path -LiteralPath $ExePath
$ico = Resolve-Path -LiteralPath $IcoPath
$source = Resolve-Path -LiteralPath $SourcePng

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$sourceImage = [System.Drawing.Image]::FromFile($source)
try {
  Assert-Hnl ($sourceImage.Width -ge 1024 -and $sourceImage.Height -ge 1024) "canonical logo source is at least 1024x1024 ($($sourceImage.Width)x$($sourceImage.Height))"
} finally {
  $sourceImage.Dispose()
}

$bytes = [System.IO.File]::ReadAllBytes($ico)
Assert-Hnl ($bytes.Length -gt 20000) "generated ICO is non-trivial ($($bytes.Length) bytes)"
Assert-Hnl ($bytes.Length -ge 6) 'ICO header exists'
$reserved = [BitConverter]::ToUInt16($bytes, 0)
$type = [BitConverter]::ToUInt16($bytes, 2)
$count = [BitConverter]::ToUInt16($bytes, 4)
Assert-Hnl ($reserved -eq 0 -and $type -eq 1) 'ICO header type is valid'
Assert-Hnl ($count -eq $requiredSizes.Count) "ICO contains exactly $($requiredSizes.Count) frames"

$frames = @()
for ($i = 0; $i -lt $count; $i++) {
  $entry = 6 + (16 * $i)
  Assert-Hnl (($entry + 16) -le $bytes.Length) "ICO directory entry $i is in bounds"
  $w = [int]$bytes[$entry]; if ($w -eq 0) { $w = 256 }
  $h = [int]$bytes[$entry + 1]; if ($h -eq 0) { $h = 256 }
  $planes = [BitConverter]::ToUInt16($bytes, $entry + 4)
  $bitCount = [BitConverter]::ToUInt16($bytes, $entry + 6)
  $length = [BitConverter]::ToUInt32($bytes, $entry + 8)
  $offset = [BitConverter]::ToUInt32($bytes, $entry + 12)
  Assert-Hnl ($w -eq $h) "frame ${w}x${h} is square"
  Assert-Hnl ($planes -eq 1 -and $bitCount -eq 32) "frame ${w}x${h} is 32-bit RGBA"
  Assert-Hnl (($offset + $length) -le $bytes.Length) "frame ${w}x${h} payload is in bounds"

  $payload = New-Object byte[] $length
  [Array]::Copy($bytes, [int]$offset, $payload, 0, [int]$length)
  $pngSignature = @(0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A)
  for ($p = 0; $p -lt $pngSignature.Count; $p++) {
    Assert-Hnl ($payload[$p] -eq $pngSignature[$p]) "frame ${w}x${h} uses PNG payload byte $p"
  }

  $stream = New-Object System.IO.MemoryStream(,$payload)
  $img = [System.Drawing.Bitmap]::FromStream($stream)
  try {
    Assert-Hnl ($img.Width -eq $w -and $img.Height -eq $h) "decoded frame is ${w}x${h}"
    $opaque = 0
    $transparent = 0
    $sampleStep = [Math]::Max(1, [int][Math]::Floor($w / 16))
    for ($y = 0; $y -lt $h; $y += $sampleStep) {
      for ($x = 0; $x -lt $w; $x += $sampleStep) {
        $a = $img.GetPixel($x,$y).A
        if ($a -gt 0) { $opaque++ } else { $transparent++ }
      }
    }
    Assert-Hnl ($opaque -gt 0) "frame ${w}x${h} contains visible pixels"
    $frameFile = Join-Path $EvidenceDir ("frame-{0}.png" -f $w)
    $img.Save($frameFile, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $img.Dispose()
    $stream.Dispose()
  }

  $frames += [PSCustomObject]@{ Size=$w; Bytes=$payload }
}

$actualSizes = @($frames | ForEach-Object { $_.Size } | Sort-Object)
$expectedSizes = @($requiredSizes | Sort-Object)
Assert-Hnl (($actualSizes -join ',') -eq ($expectedSizes -join ',')) "ICO frame set matches required sizes: $($expectedSizes -join ', ')"

$associated = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
Assert-Hnl ($null -ne $associated) 'EXE exposes an embedded associated icon'
try {
  $associatedBitmap = $associated.ToBitmap()
  try {
    Assert-Hnl ($associatedBitmap.Width -gt 0 -and $associatedBitmap.Height -gt 0) "EXE embedded icon renders ($($associatedBitmap.Width)x$($associatedBitmap.Height))"
    $associatedBitmap.Save((Join-Path $EvidenceDir 'exe-associated-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $associatedBitmap.Dispose() }
} finally { $associated.Dispose() }

$cellW = 300
$cellH = 330
$columns = 4
$rows = [int][Math]::Ceiling($frames.Count / [double]$columns)
$sheet = New-Object System.Drawing.Bitmap($cellW * $columns, $cellH * $rows, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
try {
  $g.Clear([System.Drawing.Color]::FromArgb(28,32,40))
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $frame = $frames[$i]
    $col = $i % $columns
    $row = [int][Math]::Floor($i / $columns)
    $cx = ($col * $cellW) + [int]($cellW / 2)
    $cy = ($row * $cellH) + 18
    $stream = New-Object System.IO.MemoryStream(,$frame.Bytes)
    $img = [System.Drawing.Bitmap]::FromStream($stream)
    try {
      $drawSize = [Math]::Min(256, [Math]::Max(64, $frame.Size))
      $x = $cx - [int]($drawSize / 2)
      $y = $cy + 24
      $g.DrawImage($img, $x, $y, $drawSize, $drawSize)
      $label = "{0}x{0}" -f $frame.Size
      $measure = $g.MeasureString($label, $font)
      $g.DrawString($label, $font, $brush, $cx - ($measure.Width / 2), ($row * $cellH) + 290)
    } finally {
      $img.Dispose()
      $stream.Dispose()
    }
  }
  $sheet.Save((Join-Path $EvidenceDir 'icon-contact-sheet.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $font.Dispose()
  $g.Dispose()
  $sheet.Dispose()
}

$report = @(
  'WINDOWS ICON GOLDEN PASS',
  "EXE=$($exe.Path)",
  "ICO=$($ico.Path)",
  "SOURCE=$($source.Path)",
  "FRAMES=$($expectedSizes -join ',')",
  "ICO_BYTES=$($bytes.Length)",
  'EXE_ASSOCIATED_ICON=PASS',
  'CONTACT_SHEET=icon-contact-sheet.png'
)
$report | Set-Content -LiteralPath (Join-Path $EvidenceDir 'windows-icon-golden.txt') -Encoding UTF8
Write-Host 'WINDOWS ICON GOLDEN PASS'
