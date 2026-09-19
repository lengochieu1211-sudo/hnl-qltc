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
assert(build.includes("[ValidateSet('PROD','DEV')]") && build.includes("$Channel = 'PROD'"), 'installer build has explicit PROD/DEV channels');
assert(build.includes("'HNL QLTC DEV'") && build.includes("'HNL QLTC'"), 'DEV and PROD install identities are isolated');
assert(build.includes('/resource:"$launcher",HNL.QLTC.Payload.Launcher'), 'setup embeds the exact built launcher payload');
assert(build.includes('HNL.QLTC.Payload.Uninstaller'), 'setup embeds its uninstaller payload');
assert(build.includes('public\\icon.png') && build.includes('Write-HnlIcoFromPng'), 'setup icon is generated from canonical HNL logo');
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
