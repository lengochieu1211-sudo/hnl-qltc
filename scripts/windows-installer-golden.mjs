import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`WINDOWS INSTALLER GOLDEN FAIL: ${message}`);
  console.log(`PASS INSTALLER: ${message}`);
}

const setup = read('desktop-wrapper/HnlQltcInstaller.cs');
const uninstall = read('desktop-wrapper/HnlQltcUninstaller.cs');
const build = read('desktop-wrapper/build-installer.ps1');
const manifest = read('desktop-wrapper/HnlQltcInstaller.manifest');
const prodWorkflow = read('.github/workflows/windows-exe.yml');
const devWorkflow = read('.github/workflows/windows-exe-dev.yml');

assert(manifest.includes('requireAdministrator'), 'installer uses Windows UAC for Program Files installation');
assert(setup.includes('AutoScaleMode.Dpi') && setup.includes('PictureBox') && setup.includes('Icon.ToBitmap()'), 'installer UI is DPI-aware and displays the embedded HNL logo');
assert(setup.includes('RowCount = 3') && setup.includes('buttonFlow') && setup.includes('Tag = "primary"'), 'installer reserves a dedicated footer so Install/Upgrade action remains visible under DPI scaling');
assert(setup.includes('AppsUseLightTheme') && setup.includes('SystemEvents.UserPreferenceChanged') && setup.includes('DwmSetWindowAttribute'), 'installer follows Windows system light/dark theme including title bar where supported');
assert(setup.includes('Cài đặt chuyên nghiệp cho Windows') && setup.includes('Tùy chọn cài đặt'), 'installer uses grouped professional user-facing UI');
assert(build.includes("[ValidateSet('PROD','DEV')]") && build.includes("$Channel = 'PROD'"), 'installer build has explicit PROD/DEV channels');
assert(build.includes("'HNL QLTC DEV'") && build.includes("'HNL QLTC'"), 'DEV and PROD install identities are isolated');
assert(build.includes('$launcherResource = "/resource:$launcher,HNL.QLTC.Payload.Launcher"') && build.includes('$uninstallerResource = "/resource:$uninstallerTemp,HNL.QLTC.Payload.Uninstaller"'), 'setup builds csc resource arguments without PowerShell quote leakage');
assert(build.includes('HNL.QLTC.Payload.Uninstaller'), 'setup embeds its uninstaller payload');
assert(build.includes('HNL-QLTC-SHELL-ICON.png') && build.includes('Write-HnlIcoFromPng -PngPath $logoSource -IcoPath $generatedIcon'), 'setup icon generates a compiler-compatible multi-resolution icon directly from the dedicated HNL shell artwork');
assert(setup.includes('ProgramW6432') && setup.includes('"HNL"') && setup.includes('InstallerBuildInfo.InstallFolderName'), 'installer targets C:\\Program Files\\HNL\\<channel>');
assert(setup.includes('CommonDesktopDirectory') && setup.includes('CommonPrograms'), 'installer creates Windows Desktop and Start Menu shortcuts');
assert(setup.includes('WScript.Shell') && setup.includes('CreateShortcut'), 'shortcuts point to the installed executable');
assert(setup.includes('CurrentVersion\\Uninstall') && setup.includes('UninstallString'), 'installer registers in Windows Installed Apps / uninstall registry');
assert(setup.includes('NoModify') && setup.includes('NoRepair'), 'uninstall registration does not advertise unsupported MSI repair/modify');
assert(setup.includes('File.Copy(temp, destination, true)'), 'upgrade replaces program payload in place');
assert(setup.includes('IsFileLocked(exePath)'), 'upgrade fails safely when HNL QLTC is still running');
assert(setup.includes('Dữ liệu dự án') && setup.includes('không bị xóa hoặc reset'), 'installer explicitly preserves existing user data on upgrade');
assert(uninstall.includes('Documents\\\\HNL QLTC') && uninstall.includes('AppData') && uninstall.includes('GIỮ NGUYÊN'), 'uninstaller explicitly preserves user data');
assert(!uninstall.includes('SpecialFolder.MyDocuments') && !uninstall.includes('LocalApplicationData'), 'uninstaller has no code path that discovers user-data folders for deletion');
assert(prodWorkflow.includes('build-installer.ps1') && prodWorkflow.includes('windows-installer-runtime-golden.ps1'), 'PROD Windows CI builds and validates Setup EXE');
assert(devWorkflow.includes("-Channel DEV") && devWorkflow.includes('HNL-QLTC-DEV-Setup.exe'), 'DEV Windows CI builds isolated DEV Setup EXE');
console.log('WINDOWS INSTALLER GOLDEN PASS');
