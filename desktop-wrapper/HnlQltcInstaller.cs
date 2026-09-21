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
        private UiTheme theme;

        private static Icon LoadBrandIcon()
        {
            try
            {
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("HNL.QLTC.Brand.Icon"))
                {
                    if (input == null) return null;
                    using (var icon = new Icon(input, 32, 32))
                        return (Icon)icon.Clone();
                }
            }
            catch { return null; }
        }

        private static Bitmap LoadBrandBitmap()
        {
            try
            {
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("HNL.QLTC.Brand.Png"))
                {
                    if (input == null) return null;
                    using (Image image = Image.FromStream(input))
                        return new Bitmap(image);
                }
            }
            catch { return null; }
        }

        internal InstallerForm()
        {
            installDirectory = InstallLayout.GetInstallDirectory();
            isUpgrade = File.Exists(Path.Combine(installDirectory, InstallerBuildInfo.InstalledExeName));
            theme = UiTheme.ReadFromSystem();

            Text = "Cài đặt " + InstallerBuildInfo.ProductLabel;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            ClientSize = new Size(720, 540);
            MinimumSize = new Size(720, 540);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;
            try
            {
                Icon = LoadBrandIcon();
                if (Icon == null) Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }
            AcceptButton = installButton;
            CancelButton = cancelButton;

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 3,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 126F));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 82F));
            Controls.Add(root);

            var header = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(28, 22, 28, 18),
                Margin = new Padding(0),
                Tag = "header"
            };
            root.Controls.Add(header, 0, 0);

            if (Icon != null)
            {
                var logo = new PictureBox
                {
                    Size = new Size(52, 52),
                    Location = new Point(28, 28),
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Image = LoadBrandBitmap() ?? Icon.ToBitmap(),
                    BackColor = Color.Transparent
                };
                header.Controls.Add(logo);
            }

            var title = new Label
            {
                AutoSize = true,
                Text = isUpgrade ? "Nâng cấp " + InstallerBuildInfo.ProductLabel : "Cài đặt " + InstallerBuildInfo.ProductLabel,
                Font = new Font("Segoe UI", 21F, FontStyle.Bold),
                Location = new Point(96, 22),
                Tag = "title"
            };
            header.Controls.Add(title);

            var subtitle = new Label
            {
                AutoSize = true,
                Text = "Ứng dụng HNL QLTC cho Windows 10/11 • " + InstallerBuildInfo.ReleaseTag,
                Location = new Point(99, 68),
                Tag = "muted"
            };
            header.Controls.Add(subtitle);

            var body = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 7,
                Padding = new Padding(28, 20, 28, 12),
                Margin = new Padding(0),
                AutoScroll = true,
                Tag = "root"
            };
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 58F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 28F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 38F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 88F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 110F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 18F));
            body.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.Controls.Add(body, 0, 1);

            var description = new Label
            {
                Dock = DockStyle.Fill,
                Text = isUpgrade
                    ? "Bản hiện có sẽ được nâng cấp tại chỗ. Dữ liệu dự án, backup, ảnh, cache và cấu hình người dùng được giữ nguyên."
                    : "Phần mềm sẽ được cài vào Program Files, tạo mục trong Start Menu, tạo shortcut ngoài Desktop và không xóa dữ liệu người dùng.",
                Tag = "body"
            };
            body.Controls.Add(description, 0, 0);

            var pathCaption = new Label
            {
                Dock = DockStyle.Fill,
                Text = "Thư mục cài đặt",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                TextAlign = ContentAlignment.BottomLeft,
                Tag = "section-title"
            };
            body.Controls.Add(pathCaption, 0, 1);

            var pathBox = new TextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                Text = installDirectory,
                Margin = new Padding(0, 0, 0, 0),
                TabStop = false,
                Tag = "textbox"
            };
            body.Controls.Add(pathBox, 0, 2);

            var optionsCard = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(18, 14, 18, 12),
                Margin = new Padding(0, 12, 0, 10),
                Tag = "card"
            };
            body.Controls.Add(optionsCard, 0, 3);

            var optionsTitle = new Label
            {
                AutoSize = true,
                Text = "Tùy chọn cài đặt",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                Location = new Point(18, 12),
                Tag = "section-title"
            };
            optionsCard.Controls.Add(optionsTitle);

            desktopShortcut = new CheckBox
            {
                AutoSize = true,
                Text = "Tạo biểu tượng HNL QLTC ngoài Desktop",
                Checked = true,
                Location = new Point(18, 40),
                Tag = "checkbox"
            };
            optionsCard.Controls.Add(desktopShortcut);

            launchAfterInstall = new CheckBox
            {
                AutoSize = true,
                Text = "Mở HNL QLTC sau khi hoàn tất",
                Checked = true,
                Location = new Point(18, 66),
                Tag = "checkbox"
            };
            optionsCard.Controls.Add(launchAfterInstall);

            var summaryCard = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(18, 14, 18, 14),
                Margin = new Padding(0, 0, 0, 12),
                Tag = "card"
            };
            body.Controls.Add(summaryCard, 0, 4);

            var summaryTitle = new Label
            {
                AutoSize = true,
                Text = "Cài đặt chuyên nghiệp cho Windows",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                Location = new Point(18, 12),
                Tag = "section-title"
            };
            summaryCard.Controls.Add(summaryTitle);

            var summary = new Label
            {
                AutoSize = false,
                Width = 600,
                Height = 72,
                Text = "• Cài thẳng vào C:\\Program Files\\HNL\\...\r\n" +
                       "• Tạo Start Menu > HNL và shortcut ngoài Desktop\r\n" +
                       "• Dữ liệu dự án, backup, ảnh và cache không bị xóa hoặc reset",
                Location = new Point(18, 38),
                Tag = "muted"
            };
            summaryCard.Controls.Add(summary);

            progress = new ProgressBar
            {
                Dock = DockStyle.Fill,
                Height = 18,
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Margin = new Padding(0, 0, 0, 8)
            };
            body.Controls.Add(progress, 0, 5);

            stateLabel = new Label
            {
                Dock = DockStyle.Fill,
                Text = isUpgrade ? "Sẵn sàng nâng cấp." : "Sẵn sàng cài đặt.",
                Tag = "muted"
            };
            body.Controls.Add(stateLabel, 0, 6);

            var footer = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(28, 12, 28, 18),
                Margin = new Padding(0),
                Tag = "footer"
            };
            root.Controls.Add(footer, 0, 2);

            var buttonFlow = new FlowLayoutPanel
            {
                Dock = DockStyle.Right,
                Width = 310,
                Height = 48,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Padding = new Padding(0),
                Margin = new Padding(0),
                BackColor = Color.Transparent
            };
            footer.Controls.Add(buttonFlow);

            installButton = new Button
            {
                Text = isUpgrade ? "Nâng cấp" : "Cài đặt",
                Width = 146,
                Height = 44,
                Margin = new Padding(12, 0, 0, 0),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Tag = "primary"
            };
            installButton.Click += delegate { Install(); };
            buttonFlow.Controls.Add(installButton);

            cancelButton = new Button
            {
                Text = "Hủy",
                Width = 132,
                Height = 44,
                Margin = new Padding(0),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10F, FontStyle.Regular),
                Cursor = Cursors.Hand,
                Tag = "secondary"
            };
            cancelButton.Click += delegate { Close(); };
            buttonFlow.Controls.Add(cancelButton);

            AcceptButton = installButton;
            CancelButton = cancelButton;

            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
            FormClosed += delegate { SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged; };
            Shown += delegate { ApplyTheme(); };
            ApplyTheme();
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category != UserPreferenceCategory.General &&
                e.Category != UserPreferenceCategory.Color &&
                e.Category != UserPreferenceCategory.VisualStyle)
            {
                return;
            }

            theme = UiTheme.ReadFromSystem();
            ApplyTheme();
        }

        private void ApplyTheme()
        {
            UiTheme.ApplyToForm(this, theme);
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
                string iconPath = Path.Combine(installDirectory, InstallerBuildInfo.IconFileName);
                ExtractEmbeddedFile("HNL.QLTC.Brand.Icon", iconPath);
                progress.Value = 60;

                stateLabel.Text = "Đang tạo Start Menu và Desktop shortcut...";
                Refresh();
                Directory.CreateDirectory(InstallLayout.GetStartMenuFolder());
                InstallLayout.CreateShortcut(InstallLayout.GetStartMenuShortcutPath(), exePath, iconPath);
                if (desktopShortcut.Checked)
                    InstallLayout.CreateShortcut(InstallLayout.GetDesktopShortcutPath(), exePath, iconPath);
                else
                    InstallLayout.RemoveShortcut(InstallLayout.GetDesktopShortcutPath());
                progress.Value = 78;

                stateLabel.Text = "Đang đăng ký gỡ cài đặt và hoàn tất nâng cấp...";
                Refresh();
                RegisterUninstall(uninstallPath, exePath, iconPath);
                InstallLayout.RefreshShellIcons();
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

        private static void RegisterUninstall(string uninstallPath, string exePath, string iconPath)
        {
            const string uninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
            using (RegistryKey root = Registry.LocalMachine.CreateSubKey(uninstallRoot))
            using (RegistryKey key = root.CreateSubKey(InstallerBuildInfo.RegistryKeyName))
            {
                key.SetValue("DisplayName", InstallerBuildInfo.ProductLabel, RegistryValueKind.String);
                key.SetValue("DisplayVersion", InstallerBuildInfo.ReleaseTag, RegistryValueKind.String);
                key.SetValue("Publisher", "HNL", RegistryValueKind.String);
                key.SetValue("InstallLocation", InstallLayout.GetInstallDirectory(), RegistryValueKind.String);
                key.SetValue("DisplayIcon", "\"" + iconPath + "\",0", RegistryValueKind.String);
                key.SetValue("UninstallString", "\"" + uninstallPath + "\"", RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"), RegistryValueKind.String);
            }
        }
    }

    internal sealed class UiTheme
    {
        internal bool IsDark;
        internal Color WindowBack;
        internal Color Surface;
        internal Color SurfaceAlt;
        internal Color Border;
        internal Color Primary;
        internal Color PrimaryText;
        internal Color Text;
        internal Color TextMuted;
        internal Color TextSubtle;
        internal Color InputBack;

        internal static UiTheme ReadFromSystem()
        {
            bool dark = false;
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object value = key == null ? null : key.GetValue("AppsUseLightTheme");
                    if (value is int)
                        dark = ((int)value) == 0;
                }
            }
            catch { }

            if (dark)
            {
                return new UiTheme
                {
                    IsDark = true,
                    WindowBack = Color.FromArgb(18, 21, 27),
                    Surface = Color.FromArgb(28, 34, 43),
                    SurfaceAlt = Color.FromArgb(37, 45, 57),
                    Border = Color.FromArgb(58, 67, 81),
                    Primary = Color.FromArgb(50, 120, 220),
                    PrimaryText = Color.White,
                    Text = Color.FromArgb(236, 241, 248),
                    TextMuted = Color.FromArgb(188, 198, 212),
                    TextSubtle = Color.FromArgb(149, 160, 176),
                    InputBack = Color.FromArgb(24, 29, 38)
                };
            }

            return new UiTheme
            {
                IsDark = false,
                WindowBack = Color.FromArgb(246, 248, 251),
                Surface = Color.White,
                SurfaceAlt = Color.FromArgb(247, 249, 252),
                Border = Color.FromArgb(212, 220, 230),
                Primary = Color.FromArgb(24, 86, 164),
                PrimaryText = Color.White,
                Text = Color.FromArgb(25, 46, 80),
                TextMuted = Color.FromArgb(65, 77, 93),
                TextSubtle = Color.FromArgb(88, 99, 115),
                InputBack = Color.White
            };
        }

        internal static void ApplyToForm(Form form, UiTheme theme)
        {
            if (form == null || theme == null) return;
            ApplyImmersiveDarkMode(form, theme.IsDark);
            ApplyControl(form, theme, theme.WindowBack);
        }

        private static void ApplyControl(Control control, UiTheme theme, Color inheritedBack)
        {
            if (control == null) return;
            string tag = control.Tag as string;
            Color back = inheritedBack;

            if (control is Form)
            {
                control.BackColor = theme.WindowBack;
                control.ForeColor = theme.Text;
                back = theme.WindowBack;
            }
            else if (control is Panel || control is TableLayoutPanel || control is FlowLayoutPanel)
            {
                if (tag == "header" || tag == "card") back = theme.Surface;
                else if (tag == "footer") back = theme.WindowBack;
                else back = theme.WindowBack;
                control.BackColor = back;
                control.ForeColor = theme.Text;
            }
            else if (control is Label)
            {
                control.BackColor = inheritedBack;
                if (tag == "title" || tag == "section-title") control.ForeColor = theme.Text;
                else if (tag == "muted") control.ForeColor = theme.TextSubtle;
                else control.ForeColor = theme.TextMuted;
                back = inheritedBack;
            }
            else if (control is TextBox)
            {
                TextBox box = (TextBox)control;
                box.BackColor = theme.InputBack;
                box.ForeColor = theme.Text;
                box.BorderStyle = BorderStyle.FixedSingle;
                back = box.BackColor;
            }
            else if (control is CheckBox)
            {
                control.BackColor = inheritedBack;
                control.ForeColor = theme.TextMuted;
                back = inheritedBack;
            }
            else if (control is Button)
            {
                Button button = (Button)control;
                button.FlatAppearance.BorderSize = 1;
                button.FlatAppearance.MouseDownBackColor = theme.IsDark ? Color.FromArgb(44, 72, 112) : Color.FromArgb(19, 72, 140);
                button.FlatAppearance.MouseOverBackColor = theme.IsDark ? Color.FromArgb(63, 86, 122) : Color.FromArgb(231, 239, 250);
                if (tag == "primary")
                {
                    button.BackColor = theme.Primary;
                    button.ForeColor = theme.PrimaryText;
                    button.FlatAppearance.BorderColor = theme.Primary;
                }
                else
                {
                    button.BackColor = theme.SurfaceAlt;
                    button.ForeColor = theme.Text;
                    button.FlatAppearance.BorderColor = theme.Border;
                }
                back = button.BackColor;
            }
            else
            {
                control.BackColor = inheritedBack;
                control.ForeColor = theme.Text;
                back = inheritedBack;
            }

            foreach (Control child in control.Controls)
            {
                ApplyControl(child, theme, back);
            }
        }

        private static void ApplyImmersiveDarkMode(Form form, bool dark)
        {
            try
            {
                if (!form.IsHandleCreated) return;
                int useDark = dark ? 1 : 0;
                int attribute = 20;
                if (DwmSetWindowAttribute(form.Handle, attribute, ref useDark, Marshal.SizeOf(typeof(int))) != 0)
                {
                    attribute = 19;
                    DwmSetWindowAttribute(form.Handle, attribute, ref useDark, Marshal.SizeOf(typeof(int)));
                }
            }
            catch { }
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int pvAttribute, int cbAttribute);
    }

    internal static class InstallLayout
    {
        private const uint SHCNE_UPDATEITEM = 0x00002000;
        private const uint SHCNE_ASSOCCHANGED = 0x08000000;
        private const uint SHCNF_IDLIST = 0x0000;
        private const uint SHCNF_PATHW = 0x0005;

        [DllImport("shell32.dll", EntryPoint = "SHChangeNotify", CharSet = CharSet.Unicode)]
        private static extern void SHChangeNotifyPath(uint eventId, uint flags, string item1, IntPtr item2);

        [DllImport("shell32.dll", EntryPoint = "SHChangeNotify")]
        private static extern void SHChangeNotifyPtr(uint eventId, uint flags, IntPtr item1, IntPtr item2);

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

        internal static void CreateShortcut(string shortcutPath, string targetPath, string iconPath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            if (File.Exists(shortcutPath)) File.Delete(shortcutPath);
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
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                try { SHChangeNotifyPath(SHCNE_UPDATEITEM, SHCNF_PATHW, shortcutPath, IntPtr.Zero); } catch { }
            }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        internal static void RemoveShortcut(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                    try { SHChangeNotifyPath(SHCNE_UPDATEITEM, SHCNF_PATHW, path, IntPtr.Zero); } catch { }
                }
            }
            catch { }
        }

        internal static void RefreshShellIcons()
        {
            try { SHChangeNotifyPtr(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero); } catch { }
        }
    }
}
