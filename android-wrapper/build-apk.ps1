$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$sdk = 'C:\Users\ngoch\AppData\Local\Android\Sdk'
$buildTools = Join-Path $sdk 'build-tools\36.0.0'
$platform = Join-Path $sdk 'platforms\android-37.0'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'

$aapt2 = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$androidJar = Join-Path $platform 'android.jar'
$javac = Join-Path $javaHome 'bin\javac.exe'
$keytool = Join-Path $javaHome 'bin\keytool.exe'

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner, $androidJar, $javac, $keytool)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Missing build tool: $tool"
    }
}

$env:JAVA_HOME = $javaHome
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path

function Invoke-Tool {
    param(
        [Parameter(Mandatory = $true)][string] $File,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')"
    }
}

$dist = Join-Path $projectRoot 'dist'
$assets = Join-Path $root 'assets\www'
$build = Join-Path $root 'build'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
$generated = Join-Path $build 'generated'
$compiled = Join-Path $build 'compiled-res.zip'
$unsignedApk = Join-Path $build 'qlct-unsigned.apk'
$alignedApk = Join-Path $build 'qlct-aligned.apk'
$keystore = Join-Path $root 'qlct-debug.keystore'
$finalApk = Join-Path $projectRoot 'HNL Quản Lý Thi Công.apk'
$stringsXml = Join-Path $root 'res\values\strings.xml'
$webUrlFile = Join-Path $root 'web-url.txt'

$webUrl = $env:QLCT_WEB_URL
if (-not $webUrl -and (Test-Path -LiteralPath $webUrlFile)) {
    $webUrl = (Get-Content -Raw -LiteralPath $webUrlFile).Trim()
}

if ($webUrl) {
    if ($webUrl -notmatch '^https?://') {
        throw "QLCT_WEB_URL must start with http:// or https://"
    }
    $escapedWebUrl = [System.Security.SecurityElement]::Escape($webUrl)
    $strings = Get-Content -Raw -LiteralPath $stringsXml
    $strings = $strings -replace '<string name="web_url">.*?</string>', "<string name=`"web_url`">$escapedWebUrl</string>"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($stringsXml, $strings, $utf8NoBom)
    Write-Output "Android wrapper web URL: $webUrl"
} else {
    Write-Output "Android wrapper web URL not configured; APK will use bundled fallback assets."
}

if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
    throw "Missing web build. Run Vite build first so dist\index.html exists."
}

foreach ($dir in @($assets, $build)) {
    $resolvedParent = Resolve-Path -LiteralPath (Split-Path -Parent $dir)
    if (-not $resolvedParent.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean path outside wrapper: $dir"
    }
}

if (Test-Path -LiteralPath $assets) {
    Get-ChildItem -LiteralPath $assets -Force | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Path $assets | Out-Null
}

if (Test-Path -LiteralPath $build) {
    Get-ChildItem -LiteralPath $build -Force | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Path $build | Out-Null
}

New-Item -ItemType Directory -Force -Path $classes, $dex, $generated | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $assets -Recurse -Force
Get-ChildItem -LiteralPath $assets -Recurse -Filter '*.map' | Remove-Item -Force

Invoke-Tool $aapt2 @('compile', '--dir', (Join-Path $root 'res'), '-o', $compiled)

Invoke-Tool $aapt2 @(
    'link',
    '-o', $unsignedApk,
    '-I', $androidJar,
    '--manifest', (Join-Path $root 'AndroidManifest.xml'),
    '-R', $compiled,
    '--java', $generated,
    '--min-sdk-version', '23',
    '--target-sdk-version', '37',
    '--auto-add-overlay'
)

$javaFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $root 'src') -Recurse -Filter '*.java'
    Get-ChildItem -LiteralPath $generated -Recurse -Filter '*.java'
) | ForEach-Object { $_.FullName }
$javacArgs = @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', $classes) + $javaFiles
Invoke-Tool $javac $javacArgs

$classFiles = Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
Invoke-Tool $d8 (@('--release', '--min-api', '23', '--lib', $androidJar, '--output', $dex) + $classFiles)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-ZipEntry {
    param(
        [Parameter(Mandatory = $true)] $Zip,
        [Parameter(Mandatory = $true)][string] $File,
        [Parameter(Mandatory = $true)][string] $EntryName
    )

    $normalizedEntryName = $EntryName -replace '\\', '/'
    $existing = $Zip.GetEntry($normalizedEntryName)
    if ($existing -ne $null) {
        $existing.Delete()
    }

    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Zip,
        $File,
        $normalizedEntryName,
        [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
}

$zip = [System.IO.Compression.ZipFile]::Open($unsignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    Add-ZipEntry $zip (Join-Path $dex 'classes.dex') 'classes.dex'

    $assetRoot = Join-Path $root 'assets'
    $assetRootPrefix = (Resolve-Path -LiteralPath $assetRoot).Path.TrimEnd('\') + '\'
    $assetFiles = Get-ChildItem -LiteralPath $assetRoot -Recurse -File
    foreach ($assetFile in $assetFiles) {
        $relativePath = $assetFile.FullName.Substring($assetRootPrefix.Length)
        Add-ZipEntry $zip $assetFile.FullName ('assets/' + $relativePath)
    }
} finally {
    $zip.Dispose()
}

Invoke-Tool $zipalign @('-f', '-p', '4', $unsignedApk, $alignedApk)

if (-not (Test-Path -LiteralPath $keystore)) {
    Invoke-Tool $keytool @(
        '-genkeypair',
        '-keystore', $keystore,
        '-alias', 'qlct',
        '-storepass', 'android',
        '-keypass', 'android',
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-dname', 'CN=HNL,O=Codex,C=VN'
    )
}

Invoke-Tool $apksigner @(
    'sign',
    '--ks', $keystore,
    '--ks-key-alias', 'qlct',
    '--ks-pass', 'pass:android',
    '--key-pass', 'pass:android',
    '--out', $finalApk,
    $alignedApk
)

Invoke-Tool $apksigner @('verify', '--verbose', $finalApk)
Write-Output "APK created: $finalApk"
