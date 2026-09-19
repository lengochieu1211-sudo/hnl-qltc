param(
  [Parameter(Mandatory = $true)] [string]$SetupPath,
  [Parameter(Mandatory = $true)] [string]$LauncherPath,
  [ValidateSet('PROD','DEV')] [string]$Channel = 'PROD'
)

$ErrorActionPreference = 'Stop'
function Assert-Hnl([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "WINDOWS INSTALLER RUNTIME GOLDEN FAIL: $Message" }
  Write-Host "PASS SETUP: $Message"
}

$setup = Resolve-Path -LiteralPath $SetupPath
$launcher = Resolve-Path -LiteralPath $LauncherPath
$setupItem = Get-Item -LiteralPath $setup
$launcherItem = Get-Item -LiteralPath $launcher
Assert-Hnl ($setupItem.Length -gt $launcherItem.Length) 'Setup EXE is larger than embedded launcher payload'
Assert-Hnl ($setupItem.Length -gt 100KB) 'Setup EXE has a non-trivial packaged payload'

$setupVersion = [System.Reflection.AssemblyName]::GetAssemblyName($setup.Path).Version
$launcherVersion = [System.Reflection.AssemblyName]::GetAssemblyName($launcher.Path).Version
Assert-Hnl ($setupVersion.ToString(3) -eq $launcherVersion.ToString(3)) 'Setup and launcher share package semantic version'

$info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($setup.Path)
if ($Channel -eq 'DEV') {
  Assert-Hnl ($info.ProductName -match 'HNL QLTC DEV') 'DEV Setup product identity is isolated from PROD'
} else {
  Assert-Hnl ($info.ProductName -eq 'HNL QLTC') 'PROD Setup product identity is HNL QLTC'
}
Assert-Hnl ($info.CompanyName -eq 'HNL') 'Setup publisher metadata is HNL'

Write-Host 'WINDOWS INSTALLER RUNTIME GOLDEN PASS'
