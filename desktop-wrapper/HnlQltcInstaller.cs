using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HnlQltcSetup
{
    internal static class SetupProgram
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly Button installButton;
        private readonly Button cancelButton;
        private readonly CheckBox desktopShortcut;
        private readonly CheckBox launchAfterInstall;
        private readonly Label stateLabel;
        private readonly ProgressBar progress;
        private readonly string installDirectory;
        private readonly bool isUpgrade;

        internal InstallerForm()
        {
            installDirectory = InstallLayout.GetInstallDirectory();
            isUpgrade = File.Exists(Path.Combine(installDirectory, InstallerBuildInfo.InstalledExeName));

            Text = "Cài đặt " + InstallerBuildInfo.ProductLabel;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(660, 430);
            BackColor = Color.FromArgb(246, 248, 251);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 116,
                BackColor = Color.White,
                Padding = new Padding(28, 22, 28, 18)
            };
            Controls.Add(header);

            if (Icon != null)
            {
                var logo = new PictureBox
                {
                    Size = new Size(48, 48),
                    Location = new Point(28, 26),
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Image = Icon.ToBitmap()
                };
                header.Controls.Add(logo);
            }

            var title = new Label
            {
                AutoSize = true,
                Text = isUpgrade ? "Nâng cấp " + InstallerBuildInfo.ProductLabel : "Cài đặt " + InstallerBuildInfo.ProductLabel,
                Font = new Font("Segoe UI", 20F, FontStyle.Bold),
                ForeColor = Color.FromArgb(25, 46, 80),
                Location = new Point(88, 20)
            };
            header.Controls.Add(title);

            var subtitle = new Label
            {
                AutoSize = true,
                Text = "Ứng dụng HNL QLTC cho Windows 10/11 • " + InstallerBuildInfo.ReleaseTag,
                ForeColor = Color.FromArgb(88, 99, 115),
                Location = new Point(91, 67)
            };
            header.Controls.Add(subtitle);

            var body = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(30, 22, 30, 20),
                BackColor = BackColor
            };
            Controls.Add(body);
            body.BringToFront();

            var description = new Label
            {
                AutoSize = false,
                Width = 595,
                Height = 58,
                Text = isUpgrade
                    ? "Bản hiện có sẽ được nâng cấp tại chỗ. Dữ liệu dự án, backup, ảnh, cache và cấu hình người dùng được giữ nguyên."
                    : "Phần mềm sẽ được cài vào Program Files, tạo mục trong Start Menu và có thể tạo biểu tượng ngoài Desktop.",
                ForeColor = Color.FromArgb(65, 77, 93),
                Location = new Point(30, 24)
            };
            body.Controls.Add(description);

            var pathCaption = new Label
            {
                AutoSize = true,
                Text = "Thư mục cài đặt",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                ForeColor = Color.FromArgb(31, 53, 82),
                Location = new Point(30, 96)
            };
            body.Controls.Add(pathCaption);

            var pathBox = new TextBox
            {
                ReadOnly = true,
                Text = installDirectory,
                Location = new Point(30, 122),
                Width = 595,
                BackColor = Color.White
            };
            body.Controls.Add(pathBox);

            desktopShortcut = new CheckBox
            {
                AutoSize = true,
                Text = "Tạo biểu tượng HNL QLTC ngoài Desktop",
                Checked = true,
                Location = new Point(30, 166)
            };
            body.Controls.Add(desktopShortcut);

            launchAfterInstall = new CheckBox
            {
                AutoSize = true,
                Text = "Mở HNL QLTC sau khi hoàn tất",
                Checked = true,
                Location = new Point(30, 196)
            };
            body.Controls.Add(launchAfterInstall);

            progress = new ProgressBar
            {
                Location = new Point(30, 236),
                Width = 595,
                Height = 18,
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };
            body.Controls.Add(progress);

            stateLabel = new Label
            {
                AutoSize = false,
                Width = 595,
                Height = 42,
                Text = isUpgrade ? "Sẵn sàng nâng cấp." : "Sẵn sàng cài đặt.",
                ForeColor = Color.FromArgb(75, 86, 101),
                Location = new Point(30, 262)
            };
            body.Controls.Add(stateLabel);

            installButton = new Button
            {
                Text = isUpgrade ? "Nâng cấp" : "Cài đặt",
                Width = 132,
                Height = 42,
                Location = new Point(354, 318),
                BackColor = Color.FromArgb(24, 86, 164),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            installButton.Click += delegate { Install(); };
            body.Controls.Add(installButton);

            cancelButton = new Button
            {
                Text = "Hủy",
                Width = 132,
                Height = 42,
                Location = new Point(493, 318),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(38, 61, 92),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            cancelButton.Click += delegate { Close(); };
            body.Controls.Add(cancelButton);
        }

        private void Install()
        {
            string exePath = Path.Combine(installDirectory, InstallerBuildInfo.InstalledExeName);
            if (InstallLayout.IsFileLocked(exePath))
            {
                MessageBox.Show(
                    InstallerBuildInfo.ProductLabel + " đang chạy. Hãy thoát hoàn toàn ứng dụng từ khay hệ thống rồi bấm " + (isUpgrade ? "Nâng cấp" : "Cài đặt") + " lại.",
                    "HNL QLTC",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return;
            }

            installButton.Enabled = false;
            cancelButton.Enabled = false;
            desktopShortcut.Enabled = false;
            launchAfterInstall.Enabled = false;
            UseWaitCursor = true;

            try
            {
                stateLabel.Text = "Đang chuẩn bị thư mục cài đặt...";
                progress.Value = 10;
                Refresh();
                Directory.CreateDirectory(installDirectory);

                stateLabel.Text = "Đang cài HNL QLTC...";
                progress.Value = 35;
                Refresh();
                ExtractEmbeddedFile("HNL.QLTC.Payload.Launcher", exePath);

                string uninstallPath = Path.Combine(installDirectory, InstallerBuildInfo.UninstallerExeName);
                ExtractEmbeddedFile("HNL.QLTC.Payload.Uninstaller", uninstallPath);
                progress.Value = 60;

                stateLabel.Text = "Đang tạo Start Menu và Desktop shortcut...";
                Refresh();
                Directory.CreateDirectory(InstallLayout.GetStartMenuFolder());
                InstallLayout.CreateShortcut(InstallLayout.GetStartMenuShortcutPath(), exePath);
                if (desktopShortcut.Checked)
                    InstallLayout.CreateShortcut(InstallLayout.GetDesktopShortcutPath(), exePath);
                else
                    InstallLayout.RemoveShortcut(InstallLayout.GetDesktopShortcutPath());
                progress.Value = 78;

                stateLabel.Text = "Đang đăng ký gỡ cài đặt và hoàn tất nâng cấp...";
                Refresh();
                RegisterUninstall(uninstallPath, exePath);
                progress.Value = 100;
                stateLabel.Text = "Hoàn tất. Dữ liệu người dùng được giữ nguyên.";

                MessageBox.Show(
                    (isUpgrade ? "Đã nâng cấp " : "Đã cài đặt ") + InstallerBuildInfo.ProductLabel + " thành công.\n\n" +
                    "Start Menu: HNL > " + InstallerBuildInfo.ShortcutName +
                    (desktopShortcut.Checked ? "\nDesktop: đã tạo shortcut." : "\nDesktop: không tạo shortcut theo lựa chọn của bạn.") +
                    "\n\nDữ liệu dự án và cache không bị xóa hoặc reset.",
                    "HNL QLTC",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );

                if (launchAfterInstall.Checked)
                {
                    Process.Start(new ProcessStartInfo { FileName = exePath, UseShellExecute = true });
                }
                Close();
            }
            catch (Exception ex)
            {
                stateLabel.Text = "Cài đặt chưa hoàn tất.";
                MessageBox.Show(
                    "Không thể cài đặt " + InstallerBuildInfo.ProductLabel + ".\n\n" + ex.Message,
                    "HNL QLTC",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                installButton.Enabled = true;
                cancelButton.Enabled = true;
                desktopShortcut.Enabled = true;
                launchAfterInstall.Enabled = true;
            }
            finally
            {
                UseWaitCursor = false;
            }
        }

        private static void ExtractEmbeddedFile(string resourceName, string destination)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream input = assembly.GetManifestResourceStream(resourceName))
            {
                if (input == null) throw new InvalidOperationException("Thiếu payload cài đặt: " + resourceName);
                string temp = destination + ".new";
                using (FileStream output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
                    input.CopyTo(output);
                File.Copy(temp, destination, true);
                File.Delete(temp);
            }
        }

        private static void RegisterUninstall(string uninstallPath, string exePath)
        {
            const string uninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
            using (RegistryKey root = Registry.LocalMachine.CreateSubKey(uninstallRoot))
            using (RegistryKey key = root.CreateSubKey(InstallerBuildInfo.RegistryKeyName))
            {
                key.SetValue("DisplayName", InstallerBuildInfo.ProductLabel, RegistryValueKind.String);
                key.SetValue("DisplayVersion", InstallerBuildInfo.ReleaseTag, RegistryValueKind.String);
                key.SetValue("Publisher", "HNL", RegistryValueKind.String);
                key.SetValue("InstallLocation", InstallLayout.GetInstallDirectory(), RegistryValueKind.String);
                key.SetValue("DisplayIcon", "\"" + exePath + "\",0", RegistryValueKind.String);
                key.SetValue("UninstallString", "\"" + uninstallPath + "\"", RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"), RegistryValueKind.String);
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

        internal static void CreateShortcut(string shortcutPath, string targetPath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("Windows Script Host không khả dụng để tạo shortcut.");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = null;
            try
            {
                shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(targetPath) });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { InstallerBuildInfo.ProductLabel });
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath + ",0" });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        internal static void RemoveShortcut(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
