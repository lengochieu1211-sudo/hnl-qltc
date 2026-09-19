using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HnlQltcSetup
{
    internal static class UninstallProgram
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DialogResult confirm = MessageBox.Show(
                "Gỡ " + InstallerBuildInfo.ProductLabel + " khỏi máy tính?\n\n" +
                "Dữ liệu người dùng trong Documents\\HNL QLTC và AppData được GIỮ NGUYÊN để tránh mất dữ liệu.",
                "Gỡ cài đặt " + InstallerBuildInfo.ProductLabel,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button2
            );
            if (confirm != DialogResult.Yes) return;

            try
            {
                string installDir = InstallLayout.GetInstallDirectory();
                string exePath = Path.Combine(installDir, InstallerBuildInfo.InstalledExeName);
                if (InstallLayout.IsFileLocked(exePath))
                {
                    MessageBox.Show(
                        InstallerBuildInfo.ProductLabel + " đang chạy. Hãy thoát hoàn toàn ứng dụng từ khay hệ thống rồi thử lại.",
                        "Không thể gỡ cài đặt",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return;
                }

                InstallLayout.RemoveShortcut(InstallLayout.GetDesktopShortcutPath());
                InstallLayout.RemoveShortcut(InstallLayout.GetStartMenuShortcutPath());
                InstallLayout.TryDeleteEmptyDirectory(InstallLayout.GetStartMenuFolder());
                InstallLayout.RemoveUninstallRegistry();

                foreach (string file in Directory.GetFiles(installDir))
                {
                    string full = Path.GetFullPath(file);
                    if (string.Equals(full, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) continue;
                    try { File.Delete(full); } catch { }
                }
                foreach (string dir in Directory.GetDirectories(installDir))
                {
                    try { Directory.Delete(dir, true); } catch { }
                }

                string cleanupScript = Path.Combine(
                    Path.GetTempPath(),
                    "hnl-qltc-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd"
                );
                File.WriteAllText(
                    cleanupScript,
                    "@echo off\r\n" +
                    "ping 127.0.0.1 -n 3 >nul\r\n" +
                    "rmdir /s /q \"" + installDir.Replace("\"", "\"\"") + "\"\r\n" +
                    "del /f /q \"%~f0\"\r\n"
                );
                var cleanup = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/d /c call \"" + cleanupScript + "\"",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(cleanup);

                MessageBox.Show(
                    "Đã gỡ " + InstallerBuildInfo.ProductLabel + ".\n\nDữ liệu dự án, backup, ảnh và cache người dùng không bị xóa.",
                    "Hoàn tất",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Không thể gỡ cài đặt.\n\n" + ex.Message,
                    "HNL QLTC",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }

    internal static class InstallLayout
    {
        internal static string GetProgramFilesRoot()
        {
            string programW6432 = Environment.GetEnvironmentVariable("ProgramW6432");
            if (!string.IsNullOrWhiteSpace(programW6432)) return programW6432;
            return Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        }

        internal static string GetInstallDirectory()
        {
            return Path.Combine(GetProgramFilesRoot(), "HNL", InstallerBuildInfo.InstallFolderName);
        }

        internal static string GetDesktopShortcutPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), InstallerBuildInfo.ShortcutName + ".lnk");
        }

        internal static string GetStartMenuFolder()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "HNL");
        }

        internal static string GetStartMenuShortcutPath()
        {
            return Path.Combine(GetStartMenuFolder(), InstallerBuildInfo.ShortcutName + ".lnk");
        }

        internal static bool IsFileLocked(string path)
        {
            if (!File.Exists(path)) return false;
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
                return false;
            }
            catch (IOException) { return true; }
            catch (UnauthorizedAccessException) { return true; }
        }

        internal static void RemoveShortcut(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        internal static void TryDeleteEmptyDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path) && Directory.GetFileSystemEntries(path).Length == 0) Directory.Delete(path);
            }
            catch { }
        }

        internal static void RemoveUninstallRegistry()
        {
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true))
                {
                    if (key != null) key.DeleteSubKeyTree(InstallerBuildInfo.RegistryKeyName, false);
                }
            }
            catch { }
        }
    }
}
