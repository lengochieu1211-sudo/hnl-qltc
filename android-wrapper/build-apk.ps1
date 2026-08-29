$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root

function Resolve-AndroidSdk {
    $candidate = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        "$env:LOCALAPPDATA\Android\Sdk",
        "$env:USERPROFILE\AppData\Local\Android\Sdk"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $candidate) { throw 'Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.' }
    return (Resolve-Path -LiteralPath ([string]$candidate)).Path
}

function Resolve-JavaHome {
    $candidate = @(
        $env:JAVA_HOME,
        'C:\Program Files\Android\Android Studio\jbr',
        'C:\Program Files\Java\jdk-21',
        'C:\Program Files\Java\jdk-17'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\javac.exe')) } | Select-Object -First 1
    if (-not $candidate) { throw 'JDK not found. Set JAVA_HOME to a JDK containing javac.exe.' }
    return (Resolve-Path -LiteralPath ([string]$candidate)).Path
}

function Resolve-LatestVersionDir {
    param([Parameter(Mandatory = $true)][string] $BasePath)
    if (-not (Test-Path -LiteralPath $BasePath)) { throw "Missing directory: $BasePath" }
    $dirs = @(Get-ChildItem -LiteralPath $BasePath -Directory | Sort-Object {
        try { [version]($_.Name -replace '[^0-9.]','') } catch { [version]'0.0' }
    } -Descending)
    if (-not $dirs -or $dirs.Count -eq 0) { throw "No version directories found under $BasePath" }
    return $dirs[0].FullName
}

function Invoke-Tool {
    param(
        [Parameter(Mandatory = $true)][string] $File,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')" }
}

$sdk = Resolve-AndroidSdk
$javaHome = Resolve-JavaHome
$buildTools = Resolve-LatestVersionDir (Join-Path $sdk 'build-tools')
$platform = Resolve-LatestVersionDir (Join-Path $sdk 'platforms')

$aapt2 = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$androidJar = Join-Path $platform 'android.jar'
$javac = Join-Path $javaHome 'bin\javac.exe'
$keytool = Join-Path $javaHome 'bin\keytool.exe'

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner, $androidJar, $javac, $keytool)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Missing build tool: $tool" }
}

$env:JAVA_HOME = $javaHome
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path

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
$finalApk = Join-Path $projectRoot 'HNL-QLTC-Android.apk'
$stringsXml = Join-Path $root 'res\values\strings.xml'
$webUrlFile = Join-Path $root 'web-url.txt'

$packageJsonPath = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath)) { throw "Missing package.json: $packageJsonPath" }
$packageInfo = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
$appVersion = [string]$packageInfo.version
if (-not $appVersion) { throw 'package.json version is empty' }

$semverMatch = [regex]::Match($appVersion, '^(\d+)\.(\d+)\.(\d+)')
if (-not $semverMatch.Success) { throw "Unsupported package version for Android: $appVersion" }
$major = [int]$semverMatch.Groups[1].Value
$minor = [int]$semverMatch.Groups[2].Value
$patch = [int]$semverMatch.Groups[3].Value
$versionCode = ($major * 10000) + ($minor * 100) + $patch
if ($versionCode -lt 1) { $versionCode = 1 }

$webUrl = $env:QLCT_WEB_URL
if (-not $webUrl -and (Test-Path -LiteralPath $webUrlFile)) {
    $webUrl = (Get-Content -Raw -LiteralPath $webUrlFile).Trim()
}
if (-not $webUrl) { $webUrl = 'https://hnlqltc.web.app/?app=android' }
if ($webUrl -notmatch '^https://') { throw 'QLCT_WEB_URL must use https://' }

$webUrl = $webUrl -replace '([?&])v=[^&]*', '$1'
$webUrl = $webUrl.TrimEnd('?','&')
if ($webUrl -notmatch '([?&])app=android(?:&|$)') {
    $webUrl += $(if ($webUrl.Contains('?')) { '&app=android' } else { '?app=android' })
}
$releaseTag = if ($env:QLCT_RELEASE_TAG) { $env:QLCT_RELEASE_TAG.Trim() } else { $appVersion }
$webUrl += "&v=$releaseTag"
$escapedWebUrl = [System.Security.SecurityElement]::Escape($webUrl)
$strings = Get-Content -Raw -LiteralPath $stringsXml
$strings = $strings -replace '<string name="web_url">.*?</string>', "<string name=`"web_url`">$escapedWebUrl</string>"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($stringsXml, $strings, $utf8NoBom)

Write-Output "Android SDK: $sdk"
Write-Output "Android build-tools: $buildTools"
Write-Output "Android platform: $platform"
Write-Output "JAVA_HOME: $javaHome"
Write-Output "Android versionName=$appVersion versionCode=$versionCode"
Write-Output "Android wrapper web URL: $webUrl"

if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
    throw 'Missing web build. Run npm run build before building the APK.'
}

foreach ($dir in @($assets, $build)) {
    $parent = Split-Path -Parent $dir
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $resolvedParent = (Resolve-Path -LiteralPath $parent).Path
    if (-not $resolvedParent.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean path outside wrapper: $dir"
    }
}

if (Test-Path -LiteralPath $assets) { Get-ChildItem -LiteralPath $assets -Force | Remove-Item -Recurse -Force }
else { New-Item -ItemType Directory -Path $assets | Out-Null }
if (Test-Path -LiteralPath $build) { Get-ChildItem -LiteralPath $build -Force | Remove-Item -Recurse -Force }
else { New-Item -ItemType Directory -Path $build | Out-Null }
New-Item -ItemType Directory -Force -Path $classes, $dex, $generated | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $assets -Recurse -Force
Get-ChildItem -LiteralPath $assets -Recurse -Filter '*.map' | Remove-Item -Force

Invoke-Tool $aapt2 @('compile', '--dir', (Join-Path $root 'res'), '-o', $compiled)
Invoke-Tool $aapt2 @(
    'link', '-o', $unsignedApk, '-I', $androidJar,
    '--manifest', (Join-Path $root 'AndroidManifest.xml'), '-R', $compiled,
    '--java', $generated, '--min-sdk-version', '23', '--target-sdk-version', '35',
    '--version-code', [string]$versionCode, '--version-name', $appVersion, '--auto-add-overlay'
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
    if ($existing -ne $null) { $existing.Delete() }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Zip, $File, $normalizedEntryName, [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
}

$zip = [System.IO.Compression.ZipFile]::Open($unsignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    Add-ZipEntry $zip (Join-Path $dex 'classes.dex') 'classes.dex'
    $assetRoot = Join-Path $root 'assets'
    $assetRootPrefix = (Resolve-Path -LiteralPath $assetRoot).Path.TrimEnd('\') + '\'
    foreach ($assetFile in Get-ChildItem -LiteralPath $assetRoot -Recurse -File) {
        $relativePath = $assetFile.FullName.Substring($assetRootPrefix.Length)
        Add-ZipEntry $zip $assetFile.FullName ('assets/' + $relativePath)
    }
} finally { $zip.Dispose() }

Invoke-Tool $zipalign @('-f', '-p', '4', $unsignedApk, $alignedApk)

$keystoreBase64 = $env:QLCT_ANDROID_KEYSTORE_BASE64
if ($keystoreBase64) {
    [System.IO.File]::WriteAllBytes($keystore, [Convert]::FromBase64String($keystoreBase64))
}

$storePass = if ($env:QLCT_ANDROID_KEYSTORE_PASSWORD) { $env:QLCT_ANDROID_KEYSTORE_PASSWORD } else { 'android' }
$keyPass = if ($env:QLCT_ANDROID_KEY_PASSWORD) { $env:QLCT_ANDROID_KEY_PASSWORD } else { $storePass }
$keyAlias = if ($env:QLCT_ANDROID_KEY_ALIAS) { $env:QLCT_ANDROID_KEY_ALIAS } else { 'qlct' }

if (-not (Test-Path -LiteralPath $keystore)) {
    Write-Warning 'No release keystore supplied; generating a local development keystore. Keep the same release keystore for upgradeable production APKs.'
    Invoke-Tool $keytool @(
        '-genkeypair', '-keystore', $keystore, '-alias', $keyAlias,
        '-storepass', $storePass, '-keypass', $keyPass,
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-dname', 'CN=HNL QLTC,O=HNL,C=VN'
    )
}

Invoke-Tool $apksigner @(
    'sign', '--ks', $keystore, '--ks-key-alias', $keyAlias,
    '--ks-pass', "pass:$storePass", '--key-pass', "pass:$keyPass",
    '--out', $finalApk, $alignedApk
)
Invoke-Tool $apksigner @('verify', '--verbose', '--print-certs', $finalApk)
Write-Output "APK created: $finalApk"
