using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;

namespace QLTCAnPhu
{
    internal static class Program
    {
        private const string AppBaseUrl = "https://hnlqltc.web.app/?app=desktop";
        private const string ProductName = "HNL QLTC Desktop";
        private const string HostingHealthUrl = "https://hnlqltc.web.app/";
        private const string R2HealthUrl = "https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev/health";
        private const string AiHealthUrl = "https://hnl-qltc-ai-gateway.lengochieu1211.workers.dev/health";

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                DesktopPaths.EnsureWorkspace();
                Application.Run(new DesktopWebShellForm());
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Không thể mở " + ProductName + ".\n\n" + ex.Message,
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        internal static string GetReleaseTag()
        {
            return string.IsNullOrWhiteSpace(BuildInfo.ReleaseTag)
                ? GetAssemblyVersion()
                : BuildInfo.ReleaseTag;
        }

        private static string GetAssemblyVersion()
        {
            var version = typeof(Program).Assembly.GetName().Version;
            return version != null ? version.ToString(3) : "0.0.0";
        }

        internal static string BuildAppUrl()
        {
            return AppBaseUrl + "&v=" + Uri.EscapeDataString(GetReleaseTag());
        }

        internal static BrowserInfo FindBrowser()
        {
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            var candidates = new[]
            {
                new BrowserInfo(Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile", "Microsoft Edge"),
                new BrowserInfo(Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile", "Microsoft Edge"),
                new BrowserInfo(Path.Combine(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile", "Microsoft Edge"),
                new BrowserInfo(Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile", "Google Chrome"),
                new BrowserInfo(Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile", "Google Chrome"),
                new BrowserInfo(Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile", "Google Chrome")
            };

            foreach (var candidate in candidates)
            {
                if (!string.IsNullOrEmpty(candidate.ExecutablePath) && File.Exists(candidate.ExecutablePath))
                {
                    return candidate;
                }
            }

            return null;
        }

        internal static void OpenHnlQltc()
        {
            DesktopWebShellForm shell = DesktopWebShellForm.Current;
            if (shell != null && !shell.IsDisposed)
            {
                shell.ShowWebApp();
                return;
            }
            OpenHnlQltcExternal();
        }

        internal static void OpenHnlQltcExternal()
        {
            string appUrl = BuildAppUrl();
            BrowserInfo browser = FindBrowser();
            if (browser == null)
            {
                Process.Start(new ProcessStartInfo { FileName = appUrl, UseShellExecute = true });
                return;
            }

            var baseProfileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QLTCAnPhu"
            );

            // Keep the legacy Edge/Chrome profile paths unchanged so existing offline/local data is preserved.
            var profileDir = Path.Combine(baseProfileDir, browser.ProfileFolder);
            Directory.CreateDirectory(profileDir);

            var args =
                "--app=\"" + appUrl + "\"" +
                " --user-data-dir=\"" + profileDir + "\"" +
                " --no-first-run" +
                " --start-maximized";

            Process.Start(new ProcessStartInfo
            {
                FileName = browser.ExecutablePath,
                Arguments = args,
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(browser.ExecutablePath)
            });
        }

        internal sealed class BrowserInfo
        {
            public string ExecutablePath { get; private set; }
            public string ProfileFolder { get; private set; }
            public string DisplayName { get; private set; }

            public BrowserInfo(string executablePath, string profileFolder, string displayName)
            {
                ExecutablePath = executablePath;
                ProfileFolder = profileFolder;
                DisplayName = displayName;
            }
        }

        internal static class DesktopPaths
        {
            internal static readonly string WorkspaceRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "HNL QLTC"
            );
            internal static readonly string Backup = Path.Combine(WorkspaceRoot, "Backup");
            internal static readonly string Imports = Path.Combine(WorkspaceRoot, "Imports");
            internal static readonly string Exports = Path.Combine(WorkspaceRoot, "Exports");
            internal static readonly string Excel = Path.Combine(Exports, "Excel");
            internal static readonly string Pdf = Path.Combine(Exports, "PDF");
            internal static readonly string Reports = Path.Combine(WorkspaceRoot, "Reports");
            internal static readonly string Photos = Path.Combine(WorkspaceRoot, "Photos");
            internal static readonly string Diagnostics = Path.Combine(WorkspaceRoot, "Diagnostics");
            internal static readonly string DesktopBridge = Path.Combine(WorkspaceRoot, "DesktopBridge");
            internal static readonly string DesktopBridgeAcks = Path.Combine(DesktopBridge, "acks");
            internal static readonly string LocalState = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QLTCAnPhu"
            );
            internal static readonly string Logs = Path.Combine(LocalState, "Logs");
            internal static readonly string DesktopSuiteState = Path.Combine(LocalState, "DesktopSuite");
            internal static readonly string LocalDatabase = Path.Combine(DesktopSuiteState, "workspace.db");
            internal static readonly string WebView2Profile = Path.Combine(LocalState, "WebView2Profile");

            internal static void EnsureWorkspace()
            {
                string[] dirs = { WorkspaceRoot, Backup, Imports, Exports, Excel, Pdf, Reports, Photos, Diagnostics, DesktopBridge, DesktopBridgeAcks, LocalState, Logs, DesktopSuiteState, WebView2Profile };
                foreach (string dir in dirs) Directory.CreateDirectory(dir);
            }
        }

        internal sealed class DesktopSuiteForm : Form
        {
            private readonly Label statusLabel;
            private readonly Label browserLabel;
            private readonly NotifyIcon trayIcon;
            private readonly DesktopLocalStore localStore;
            private readonly System.Windows.Forms.Timer backgroundTimer;
            private int maintenanceRunning;
            private bool allowClose;
            private DesktopUiTheme theme;

            internal DesktopSuiteForm()
            {
                theme = DesktopUiTheme.ReadFromSystem();
                Text = "HNL QLTC Windows Desktop Suite";
                StartPosition = FormStartPosition.CenterScreen;
                MinimumSize = new Size(980, 680);
                Size = new Size(1180, 760);
                Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
                AutoScaleMode = AutoScaleMode.Dpi;

                try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

                var root = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 4,
                    Padding = new Padding(22),
                    Margin = new Padding(0),
                    Tag = "root"
                };
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 112));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 144));
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
                Controls.Add(root);

                var header = new Panel
                {
                    Dock = DockStyle.Fill,
                    Padding = new Padding(20, 16, 20, 14),
                    Margin = new Padding(0, 0, 0, 12),
                    Tag = "header"
                };
                root.Controls.Add(header, 0, 0);

                if (Icon != null)
                {
                    var logo = new PictureBox
                    {
                        Size = new Size(56, 56),
                        Location = new Point(0, 7),
                        SizeMode = PictureBoxSizeMode.Zoom,
                        Image = Icon.ToBitmap(),
                        BackColor = Color.Transparent
                    };
                    header.Controls.Add(logo);
                }

                var title = new Label
                {
                    AutoSize = true,
                    Text = "HNL QLTC Windows Desktop Suite",
                    Font = new Font("Segoe UI", 21F, FontStyle.Bold),
                    Location = new Point(72, 5),
                    Tag = "title"
                };
                header.Controls.Add(title);

                var subtitle = new Label
                {
                    AutoSize = true,
                    Text = "Trung tâm làm việc trên Windows cho HNL Quản Lý Thi Công",
                    Font = new Font("Segoe UI", 10F, FontStyle.Regular),
                    Location = new Point(75, 48),
                    Tag = "muted"
                };
                header.Controls.Add(subtitle);

                var themeMode = new Label
                {
                    AutoSize = true,
                    Text = "Giao diện: Tự động theo hệ thống",
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    Location = new Point(75, 73),
                    Tag = "subtle"
                };
                header.Controls.Add(themeMode);

                var versionBadge = new Label
                {
                    AutoSize = true,
                    Text = "Build " + Program.GetReleaseTag(),
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    Padding = new Padding(12, 7, 12, 7),
                    Tag = "badge"
                };
                header.Controls.Add(versionBadge);
                Action positionVersionBadge = delegate
                {
                    versionBadge.Location = new Point(Math.Max(20, header.ClientSize.Width - versionBadge.Width - 18), 12);
                };
                header.Resize += delegate { positionVersionBadge(); };
                positionVersionBadge();

                var hero = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 2,
                    RowCount = 1,
                    Margin = new Padding(0, 0, 0, 12),
                    Tag = "root"
                };
                hero.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
                hero.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
                root.Controls.Add(hero, 0, 1);

                var welcomeCard = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 3,
                    Padding = new Padding(20, 15, 20, 14),
                    Margin = new Padding(0, 0, 8, 0),
                    Tag = "card"
                };
                welcomeCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                welcomeCard.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                welcomeCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                hero.Controls.Add(welcomeCard, 0, 0);

                welcomeCard.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "Sẵn sàng mở dự án và làm việc",
                    Font = new Font("Segoe UI", 14F, FontStyle.Bold),
                    Tag = "section-title"
                }, 0, 0);

                welcomeCard.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "Mở HNL QLTC bằng chế độ app desktop, giữ profile trình duyệt riêng và quản lý dữ liệu local/ảnh hiện trường mà không phơi các chi tiết kỹ thuật ra màn hình chính.",
                    Tag = "body"
                }, 0, 1);

                welcomeCard.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "✓ Gọn cho người dùng hằng ngày    ✓ Dark mode theo Windows    ✓ Giữ nguyên engine đồng bộ đã certified",
                    TextAlign = ContentAlignment.MiddleLeft,
                    Tag = "subtle"
                }, 0, 2);

                var quickCard = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 3,
                    Padding = new Padding(18, 15, 18, 14),
                    Margin = new Padding(8, 0, 0, 0),
                    Tag = "card"
                };
                quickCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                quickCard.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                quickCard.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
                hero.Controls.Add(quickCard, 1, 0);

                quickCard.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "Thao tác nhanh",
                    Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                    Tag = "section-title"
                }, 0, 0);

                quickCard.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "Mở ứng dụng chính hoặc truy cập nhanh dữ liệu trên máy.",
                    Tag = "body"
                }, 0, 1);

                var quickButtons = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 3,
                    RowCount = 1,
                    Margin = new Padding(0),
                    Tag = "surface"
                };
                quickButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48));
                quickButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
                quickButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24));
                quickCard.Controls.Add(quickButtons, 0, 2);

                var openApp = MakePrimaryButton("Mở HNL QLTC");
                openApp.Click += delegate { SafeAction(Program.OpenHnlQltc); };
                quickButtons.Controls.Add(openApp, 0, 0);

                var openWorkspace = MakeSecondaryButton("Dữ liệu");
                openWorkspace.Click += delegate { SafeAction(delegate { OpenFolder(DesktopPaths.WorkspaceRoot); }); };
                quickButtons.Controls.Add(openWorkspace, 1, 0);

                var openSync = MakeSecondaryButton("Đồng bộ");
                openSync.Click += delegate { OpenSyncCenter(); };
                quickButtons.Controls.Add(openSync, 2, 0);

                var cards = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 2,
                    RowCount = 2,
                    Padding = new Padding(0),
                    Margin = new Padding(0),
                    Tag = "root"
                };
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                root.Controls.Add(cards, 0, 2);

                cards.Controls.Add(BuildCard(
                    "Dữ liệu & Sao lưu",
                    "Mở nhanh Backup và Imports. Dữ liệu cloud vẫn là nguồn chính; vùng local chỉ hỗ trợ làm việc và cache an toàn.",
                    new[] {
                        new CardAction("Mở Backup", DesktopPaths.Backup),
                        new CardAction("Mở Imports", DesktopPaths.Imports)
                    }), 0, 0);

                cards.Controls.Add(BuildCard(
                    "Xuất hồ sơ",
                    "Tập trung Excel, PDF và báo cáo để bàn giao, kiểm tra hoặc lưu trữ hồ sơ dự án.",
                    new[] {
                        new CardAction("Excel", DesktopPaths.Excel),
                        new CardAction("PDF", DesktopPaths.Pdf),
                        new CardAction("Reports", DesktopPaths.Reports)
                    }), 1, 0);

                cards.Controls.Add(BuildCard(
                    "Ảnh hiện trường & đồng bộ",
                    "Quản lý ảnh lưu trên máy, xem trạng thái queue/history và tiếp tục đồng bộ qua web app khi cần.",
                    new[] {
                        new CardAction("Mở Photos", DesktopPaths.Photos),
                        new CardAction("Sync Center", delegate { OpenSyncCenter(); })
                    }), 0, 1);

                cards.Controls.Add(BuildCard(
                    "Hỗ trợ & công cụ",
                    "Chẩn đoán, logs và các công cụ kỹ thuật được gom riêng để giao diện chính luôn gọn cho người dùng thông thường.",
                    new[] {
                        new CardAction("Công cụ nâng cao", delegate { OpenAdvancedTools(); }),
                        new CardAction("Logs", DesktopPaths.Logs)
                    }), 1, 1);

                var footer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Tag = "root" };
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
                root.Controls.Add(footer, 0, 3);

                statusLabel = new Label
                {
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.MiddleLeft,
                    Text = "Sẵn sàng.",
                    Tag = "muted"
                };
                footer.Controls.Add(statusLabel, 0, 0);

                browserLabel = new Label
                {
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.MiddleRight,
                    Tag = "muted"
                };
                footer.Controls.Add(browserLabel, 1, 0);

                localStore = DesktopLocalStore.TryOpen(DesktopPaths.LocalDatabase);
                RefreshBrowserLabel();
                RefreshLocalIndex(false);

                backgroundTimer = new System.Windows.Forms.Timer { Interval = 30000 };
                backgroundTimer.Tick += delegate { RunBackgroundMaintenance(); };
                backgroundTimer.Start();

                trayIcon = new NotifyIcon
                {
                    Text = "HNL QLTC Windows Desktop Suite",
                    Visible = true,
                    Icon = Icon
                };
                var menu = new ContextMenuStrip();
                menu.Items.Add("Mở HNL QLTC Desktop", null, delegate { RestoreFromTray(); });
                menu.Items.Add("Mở HNL QLTC", null, delegate { SafeAction(Program.OpenHnlQltc); });
                menu.Items.Add("Sync Center", null, delegate { RestoreFromTray(); OpenSyncCenter(); });
                menu.Items.Add("Công cụ nâng cao", null, delegate { RestoreFromTray(); OpenAdvancedTools(); });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Thoát", null, delegate { allowClose = true; Close(); });
                trayIcon.ContextMenuStrip = menu;
                trayIcon.DoubleClick += delegate { RestoreFromTray(); };

                Resize += delegate
                {
                    if (WindowState == FormWindowState.Minimized)
                    {
                        Hide();
                        trayIcon.ShowBalloonTip(1500, "HNL QLTC", "Ứng dụng vẫn đang chạy ở khay hệ thống.", ToolTipIcon.Info);
                    }
                };

                FormClosing += delegate(object sender, FormClosingEventArgs e)
                {
                    if (!allowClose && e.CloseReason == CloseReason.UserClosing)
                    {
                        e.Cancel = true;
                        Hide();
                        trayIcon.ShowBalloonTip(1200, "HNL QLTC", "Đã thu nhỏ xuống khay hệ thống. Chọn Thoát từ biểu tượng HNL để đóng hoàn toàn.", ToolTipIcon.Info);
                    }
                };

                SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
                Shown += delegate { ApplyTheme(); };
                FormClosed += delegate {
                    backgroundTimer.Stop();
                    backgroundTimer.Dispose();
                    localStore.Dispose();
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
                };

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

                theme = DesktopUiTheme.ReadFromSystem();
                ApplyTheme();
            }

            private void ApplyTheme()
            {
                DesktopUiTheme.ApplyToForm(this, theme);
            }

            private Button MakePrimaryButton(string text)
            {
                return new Button
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(0, 0, 6, 0),
                    Text = text,
                    Height = 42,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                    Cursor = Cursors.Hand,
                    Tag = "primary"
                };
            }

            private Button MakeSecondaryButton(string text)
            {
                return new Button
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(6, 0, 0, 0),
                    Text = text,
                    Height = 42,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                    Cursor = Cursors.Hand,
                    Tag = "secondary"
                };
            }

            private Panel BuildCard(string title, string description, CardAction[] actions)
            {
                var card = new Panel
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(6),
                    Padding = new Padding(18),
                    Tag = "card"
                };

                var layout = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 3,
                    Margin = new Padding(0),
                    Tag = "surface"
                };
                layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
                layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
                card.Controls.Add(layout);

                layout.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = title,
                    Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                    Tag = "section-title"
                }, 0, 0);

                layout.Controls.Add(new Label
                {
                    Dock = DockStyle.Fill,
                    Text = description,
                    Tag = "body"
                }, 0, 1);

                var actionPanel = new FlowLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    FlowDirection = FlowDirection.LeftToRight,
                    WrapContents = false,
                    AutoScroll = true,
                    Margin = new Padding(0),
                    Tag = "surface"
                };
                layout.Controls.Add(actionPanel, 0, 2);

                foreach (CardAction action in actions)
                {
                    var button = new Button
                    {
                        AutoSize = true,
                        Height = 34,
                        Text = action.Caption,
                        FlatStyle = FlatStyle.Flat,
                        Cursor = Cursors.Hand,
                        Margin = new Padding(0, 2, 8, 0),
                        Tag = "secondary"
                    };
                    string target = action.TargetPath;
                    Action handler = action.Handler;
                    button.Click += delegate {
                        if (handler != null) SafeAction(handler);
                        else SafeAction(delegate { OpenFolder(target); });
                    };
                    actionPanel.Controls.Add(button);
                }

                return card;
            }

            private void OpenAdvancedTools()
            {
                using (var form = new Form())
                {
                    form.Text = "Hỗ trợ & công cụ - HNL QLTC";
                    form.StartPosition = FormStartPosition.CenterParent;
                    form.FormBorderStyle = FormBorderStyle.FixedDialog;
                    form.MaximizeBox = false;
                    form.MinimizeBox = false;
                    form.ClientSize = new Size(760, 470);
                    form.Font = Font;
                    try { form.Icon = Icon; } catch { }

                    var root = new TableLayoutPanel
                    {
                        Dock = DockStyle.Fill,
                        RowCount = 3,
                        ColumnCount = 1,
                        Padding = new Padding(22),
                        Tag = "root"
                    };
                    root.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
                    root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                    root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
                    form.Controls.Add(root);

                    var header = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18, 14, 18, 12), Tag = "card" };
                    root.Controls.Add(header, 0, 0);
                    header.Controls.Add(new Label
                    {
                        AutoSize = true,
                        Text = "Hỗ trợ & công cụ nâng cao",
                        Font = new Font("Segoe UI", 18F, FontStyle.Bold),
                        Location = new Point(0, 0),
                        Tag = "title"
                    });
                    header.Controls.Add(new Label
                    {
                        AutoSize = false,
                        Width = 660,
                        Height = 42,
                        Text = "Dành cho quản trị hoặc hỗ trợ kỹ thuật. Người dùng hằng ngày không cần thao tác các mục bên dưới.",
                        Location = new Point(0, 39),
                        Tag = "body"
                    });

                    var tools = new TableLayoutPanel
                    {
                        ColumnCount = 2,
                        RowCount = 3,
                        Dock = DockStyle.Fill,
                        Tag = "root"
                    };
                    tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                    tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                    for (int i = 0; i < 3; i++) tools.RowStyles.Add(new RowStyle(SizeType.Percent, 33.333F));
                    root.Controls.Add(tools, 0, 1);

                    AddAdvancedToolButton(tools, "Mở Workspace", delegate { OpenFolder(DesktopPaths.WorkspaceRoot); }, 0, 0);
                    AddAdvancedToolButton(tools, "Trung tâm đồng bộ", delegate { OpenSyncCenter(); }, 1, 0);
                    AddAdvancedToolButton(tools, "Quét lại chỉ mục", delegate { RefreshLocalIndex(true); }, 0, 1);
                    AddAdvancedToolButton(tools, "Chẩn đoán hệ thống", delegate { RunDiagnostics(); }, 1, 1);
                    AddAdvancedToolButton(tools, "Thư mục Diagnostics", delegate { OpenFolder(DesktopPaths.Diagnostics); }, 0, 2);
                    AddAdvancedToolButton(tools, "Nhật ký kỹ thuật", delegate { OpenFolder(DesktopPaths.Logs); }, 1, 2);

                    root.Controls.Add(new Label
                    {
                        Dock = DockStyle.Fill,
                        Text = "SQLite, Queue, R2 và các chi tiết kỹ thuật vẫn được giữ nguyên ở lớp nền; giao diện chính chỉ hiển thị trạng thái dễ hiểu.",
                        TextAlign = ContentAlignment.MiddleLeft,
                        Tag = "muted"
                    }, 0, 2);

                    DesktopUiTheme.ApplyToForm(form, theme);
                    form.ShowDialog(this);
                }
            }

            private void AddAdvancedToolButton(TableLayoutPanel panel, string text, Action action, int column, int row)
            {
                var button = new Button
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(6),
                    Text = text,
                    FlatStyle = FlatStyle.Flat,
                    Cursor = Cursors.Hand,
                    Tag = column == 1 && row == 0 ? "primary" : "secondary"
                };
                button.Click += delegate { SafeAction(action); };
                panel.Controls.Add(button, column, row);
            }

            private void OpenSyncCenter()
            {
                if (localStore == null || !localStore.IsReady)
                {
                    MessageBox.Show("SQLite local workspace chưa sẵn sàng.", Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                using (var form = new DesktopSyncCenterForm(localStore, DesktopPaths.WorkspaceRoot))
                {
                    form.ShowDialog(this);
                }
                RefreshBrowserLabel();
            }

            private void RefreshBrowserLabel()
            {
                BrowserInfo browser = Program.FindBrowser();
                string browserText = browser == null ? "Trình duyệt Windows" : browser.DisplayName;
                if (localStore == null || !localStore.IsReady)
                {
                    browserLabel.Text = "Dữ liệu cục bộ: Cần kiểm tra • Đồng bộ: Chưa sẵn sàng • " + browserText;
                    return;
                }

                int waiting = localStore.CountQueuePending() + localStore.CountQueueReady();
                string syncText = waiting == 0 ? "Đã hoàn tất" : "Còn " + waiting + " mục";
                browserLabel.Text = "Dữ liệu cục bộ: Bình thường • Đồng bộ: " + syncText + " • " + browserText;
            }

            private void RefreshLocalIndex(bool showMessage)
            {
                if (localStore == null || !localStore.IsReady)
                {
                    if (showMessage) MessageBox.Show("SQLite local workspace chưa sẵn sàng: " + (localStore == null ? "unknown" : localStore.LastError), Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                try
                {
                    WorkspaceIndexResult result = localStore.RefreshIndex(DesktopPaths.WorkspaceRoot);
                    RefreshBrowserLabel();
                    statusLabel.Text = result.ScanIncomplete
                        ? "Một số thư mục tạm thời chưa đọc được; dữ liệu cũ vẫn được giữ an toàn."
                        : "Dữ liệu cục bộ đã cập nhật.";
                    if (showMessage)
                    {
                        MessageBox.Show(
                            "Đã cập nhật SQLite local index.\n\nFile: " + result.IndexedFiles +
                            "\nQueue mới: " + result.EnqueuedFiles +
                            "\nFile cũ đã loại khỏi index: " + result.RemovedFiles +
                            (result.ScanIncomplete ? "\nCảnh báo: scan chưa đầy đủ; không xóa stale index/queue trong lượt này." : "") +
                            "\n\nKhông có dữ liệu cloud nào bị sửa.",
                            Program.ProductName,
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                    }
                }
                catch (Exception ex)
                {
                    statusLabel.Text = "Local index lỗi: " + ex.Message;
                    if (showMessage) MessageBox.Show(ex.Message, Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }

            private void RunBackgroundMaintenance()
            {
                if (localStore == null || !localStore.IsReady) return;
                if (Interlocked.Exchange(ref maintenanceRunning, 1) != 0) return;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        localStore.RefreshIndex(DesktopPaths.WorkspaceRoot);
                        localStore.ProcessOneQueueItem(DesktopPaths.WorkspaceRoot);
                        localStore.RefreshBridgeManifest(DesktopPaths.WorkspaceRoot);
                        localStore.RunRetentionMaintenanceIfDue();
                    }
                    catch { }
                    finally
                    {
                        Interlocked.Exchange(ref maintenanceRunning, 0);
                        try
                        {
                            BeginInvoke((MethodInvoker)delegate { RefreshBrowserLabel(); });
                        }
                        catch { }
                    }
                });
            }

            private void RunDiagnostics()
            {
                Cursor = Cursors.WaitCursor;
                statusLabel.Text = "Đang kiểm tra Hosting / R2 / AI Gateway...";
                Refresh();

                try
                {
                    DesktopPaths.EnsureWorkspace();
                    var browser = Program.FindBrowser();
                    string hosting = CheckEndpoint(HostingHealthUrl);
                    string r2 = CheckEndpoint(R2HealthUrl);
                    string ai = CheckEndpoint(AiHealthUrl);
                    var drive = new DriveInfo(Path.GetPathRoot(DesktopPaths.WorkspaceRoot));

                    string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    string path = Path.Combine(DesktopPaths.Diagnostics, "HNL-QLTC-DESKTOP-DIAGNOSTIC-" + stamp + ".json");
                    string json = BuildDiagnosticJson(browser, hosting, r2, ai, drive);
                    File.WriteAllText(path, json, new UTF8Encoding(false));

                    statusLabel.Text = "Đã xuất chẩn đoán: " + Path.GetFileName(path);
                    MessageBox.Show(
                        "Đã tạo báo cáo chẩn đoán chỉ-đọc.\n\n" + path +
                        "\n\nHosting: " + hosting +
                        "\nR2: " + r2 +
                        "\nAI Gateway: " + ai,
                        Program.ProductName,
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }
                catch (Exception ex)
                {
                    statusLabel.Text = "Chẩn đoán gặp lỗi: " + ex.Message;
                    MessageBox.Show(ex.Message, Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                finally
                {
                    Cursor = Cursors.Default;
                }
            }

            private string BuildDiagnosticJson(BrowserInfo browser, string hosting, string r2, string ai, DriveInfo drive)
            {
                var sb = new StringBuilder();
                sb.AppendLine("{");
                AppendJson(sb, "schema", "hnl-qltc-desktop-diagnostic-v2", true);
                AppendJson(sb, "generatedAt", DateTime.Now.ToString("o"), true);
                AppendJson(sb, "releaseTag", Program.GetReleaseTag(), true);
                AppendJson(sb, "appUrl", Program.BuildAppUrl(), true);
                AppendJson(sb, "osVersion", Environment.OSVersion.VersionString, true);
                AppendJson(sb, "is64BitOperatingSystem", Environment.Is64BitOperatingSystem ? "true" : "false", true);
                AppendJson(sb, "machineName", Environment.MachineName, true);
                AppendJson(sb, "browser", browser == null ? "Windows default" : browser.DisplayName, true);
                AppendJson(sb, "browserExecutable", browser == null ? "" : browser.ExecutablePath, true);
                AppendJson(sb, "workspace", DesktopPaths.WorkspaceRoot, true);
                AppendJson(sb, "hosting", hosting, true);
                AppendJson(sb, "r2", r2, true);
                AppendJson(sb, "aiGateway", ai, true);
                AppendJson(sb, "sqliteReady", localStore != null && localStore.IsReady ? "true" : "false", true);
                AppendJson(sb, "sqliteDatabase", DesktopPaths.LocalDatabase, true);
                AppendJson(sb, "sqliteLastError", localStore == null ? "store unavailable" : (localStore.LastError ?? ""), true);
                AppendJson(sb, "indexedFiles", localStore != null && localStore.IsReady ? localStore.CountIndexedFiles().ToString() : "0", true);
                AppendJson(sb, "queuePending", localStore != null && localStore.IsReady ? localStore.CountQueuePending().ToString() : "0", true);
                AppendJson(sb, "queueReadyForAppSync", localStore != null && localStore.IsReady ? localStore.CountQueueReady().ToString() : "0", true);
                AppendJson(sb, "queueCompleted", localStore != null && localStore.IsReady ? localStore.CountQueueCompleted().ToString() : "0", true);
                AppendJson(sb, "syncHistoryCount", localStore != null && localStore.IsReady ? localStore.CountHistory().ToString() : "0", true);
                AppendJson(sb, "lastIndexUtc", localStore != null && localStore.IsReady ? localStore.GetLastIndexUtc() : "", true);
                AppendJson(sb, "diskRoot", drive.Name, true);
                AppendJson(sb, "diskFreeBytes", drive.AvailableFreeSpace.ToString(), false);
                sb.AppendLine("}");
                return sb.ToString();
            }

            private static void AppendJson(StringBuilder sb, string key, string value, bool comma)
            {
                sb.Append("  \"").Append(JsonEscape(key)).Append("\": \"").Append(JsonEscape(value)).Append("\"");
                if (comma) sb.Append(',');
                sb.AppendLine();
            }

            private static string JsonEscape(string value)
            {
                if (value == null) return "";
                return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
            }

            private static string CheckEndpoint(string url)
            {
                try
                {
                    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "GET";
                    req.Timeout = 6000;
                    req.ReadWriteTimeout = 6000;
                    req.UserAgent = "HNL-QLTC-Windows-Desktop-Suite/" + Program.GetReleaseTag();
                    using (var response = (HttpWebResponse)req.GetResponse())
                    {
                        int code = (int)response.StatusCode;
                        return code >= 200 && code < 400 ? "PASS HTTP " + code : "WARN HTTP " + code;
                    }
                }
                catch (WebException ex)
                {
                    var response = ex.Response as HttpWebResponse;
                    return response == null ? "FAIL " + ex.Status : "FAIL HTTP " + (int)response.StatusCode;
                }
                catch (Exception ex)
                {
                    return "FAIL " + ex.GetType().Name;
                }
            }

            private static void OpenFolder(string path)
            {
                Directory.CreateDirectory(path);
                Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
            }

            private void RestoreFromTray()
            {
                Show();
                WindowState = FormWindowState.Normal;
                Activate();
            }

            private static void SafeAction(Action action)
            {
                try { action(); }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, Program.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }

            private sealed class CardAction
            {
                internal string Caption { get; private set; }
                internal string TargetPath { get; private set; }
                internal Action Handler { get; private set; }

                internal CardAction(string caption, string targetPath)
                {
                    Caption = caption;
                    TargetPath = targetPath;
                }

                internal CardAction(string caption, Action handler)
                {
                    Caption = caption;
                    Handler = handler;
                }
            }
        }


        internal sealed class DesktopUiTheme
        {
            internal bool IsDark;
            internal Color WindowBack;
            internal Color Surface;
            internal Color SurfaceAlt;
            internal Color Border;
            internal Color Primary;
            internal Color PrimaryHover;
            internal Color Text;
            internal Color TextMuted;
            internal Color TextSubtle;
            internal Color InputBack;
            internal Color GridHeader;
            internal Color SelectionBack;
            internal Color SelectionText;

            internal static DesktopUiTheme ReadFromSystem()
            {
                bool dark = false;
                try
                {
                    using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    {
                        object value = key == null ? null : key.GetValue("AppsUseLightTheme");
                        if (value is int) dark = ((int)value) == 0;
                    }
                }
                catch { }

                if (dark)
                {
                    return new DesktopUiTheme
                    {
                        IsDark = true,
                        WindowBack = Color.FromArgb(18, 22, 29),
                        Surface = Color.FromArgb(28, 34, 43),
                        SurfaceAlt = Color.FromArgb(38, 46, 57),
                        Border = Color.FromArgb(63, 72, 86),
                        Primary = Color.FromArgb(53, 122, 224),
                        PrimaryHover = Color.FromArgb(68, 134, 232),
                        Text = Color.FromArgb(235, 240, 248),
                        TextMuted = Color.FromArgb(201, 210, 223),
                        TextSubtle = Color.FromArgb(154, 167, 184),
                        InputBack = Color.FromArgb(23, 28, 36),
                        GridHeader = Color.FromArgb(34, 40, 50),
                        SelectionBack = Color.FromArgb(57, 93, 143),
                        SelectionText = Color.White
                    };
                }

                return new DesktopUiTheme
                {
                    IsDark = false,
                    WindowBack = Color.FromArgb(244, 247, 251),
                    Surface = Color.White,
                    SurfaceAlt = Color.FromArgb(247, 249, 252),
                    Border = Color.FromArgb(214, 222, 231),
                    Primary = Color.FromArgb(24, 86, 164),
                    PrimaryHover = Color.FromArgb(33, 97, 181),
                    Text = Color.FromArgb(22, 44, 78),
                    TextMuted = Color.FromArgb(68, 79, 94),
                    TextSubtle = Color.FromArgb(94, 105, 121),
                    InputBack = Color.White,
                    GridHeader = Color.FromArgb(239, 244, 250),
                    SelectionBack = Color.FromArgb(220, 235, 252),
                    SelectionText = Color.Black
                };
            }

            internal static void ApplyToForm(Form form, DesktopUiTheme theme)
            {
                if (form == null || theme == null) return;
                ApplyImmersiveDarkMode(form, theme.IsDark);
                ApplyControl(form, theme, theme.WindowBack);
            }

            private static void ApplyControl(Control control, DesktopUiTheme theme, Color inheritedBack)
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
                    if (tag == "header" || tag == "card" || tag == "surface") back = theme.Surface;
                    else back = inheritedBack;
                    control.BackColor = back;
                    control.ForeColor = theme.Text;
                }
                else if (control is Label)
                {
                    control.BackColor = inheritedBack;
                    if (tag == "title" || tag == "section-title") control.ForeColor = theme.Text;
                    else if (tag == "badge")
                    {
                        control.BackColor = theme.SurfaceAlt;
                        control.ForeColor = theme.TextMuted;
                    }
                    else if (tag == "subtle") control.ForeColor = theme.TextSubtle;
                    else control.ForeColor = theme.TextMuted;
                    back = control.BackColor;
                }
                else if (control is Button)
                {
                    Button button = (Button)control;
                    button.FlatAppearance.BorderSize = 1;
                    if (tag == "primary")
                    {
                        button.BackColor = theme.Primary;
                        button.ForeColor = Color.White;
                        button.FlatAppearance.BorderColor = theme.Primary;
                        button.FlatAppearance.MouseOverBackColor = theme.PrimaryHover;
                        button.FlatAppearance.MouseDownBackColor = theme.PrimaryHover;
                    }
                    else
                    {
                        button.BackColor = theme.SurfaceAlt;
                        button.ForeColor = theme.Text;
                        button.FlatAppearance.BorderColor = theme.Border;
                        button.FlatAppearance.MouseOverBackColor = theme.IsDark ? Color.FromArgb(49, 58, 72) : Color.FromArgb(236, 241, 248);
                        button.FlatAppearance.MouseDownBackColor = theme.IsDark ? Color.FromArgb(55, 64, 78) : Color.FromArgb(228, 235, 245);
                    }
                    back = button.BackColor;
                }
                else if (control is TextBox)
                {
                    TextBox box = (TextBox)control;
                    box.BackColor = theme.InputBack;
                    box.ForeColor = theme.Text;
                    box.BorderStyle = BorderStyle.FixedSingle;
                    back = box.BackColor;
                }
                else if (control is ComboBox)
                {
                    ComboBox combo = (ComboBox)control;
                    combo.BackColor = theme.InputBack;
                    combo.ForeColor = theme.Text;
                    combo.FlatStyle = FlatStyle.Flat;
                    back = combo.BackColor;
                }
                else if (control is TabControl)
                {
                    control.BackColor = inheritedBack;
                    control.ForeColor = theme.Text;
                    back = inheritedBack;
                }
                else if (control is TabPage)
                {
                    control.BackColor = theme.Surface;
                    control.ForeColor = theme.Text;
                    back = theme.Surface;
                }
                else if (control is DataGridView)
                {
                    ApplyGrid((DataGridView)control, theme);
                    back = theme.Surface;
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

            internal static void ApplyGrid(DataGridView grid, DesktopUiTheme theme)
            {
                grid.BackgroundColor = theme.Surface;
                grid.GridColor = theme.Border;
                grid.EnableHeadersVisualStyles = false;
                grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.Single;
                grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
                grid.BorderStyle = BorderStyle.None;
                grid.ColumnHeadersDefaultCellStyle.BackColor = theme.GridHeader;
                grid.ColumnHeadersDefaultCellStyle.ForeColor = theme.Text;
                grid.ColumnHeadersDefaultCellStyle.SelectionBackColor = theme.GridHeader;
                grid.ColumnHeadersDefaultCellStyle.SelectionForeColor = theme.Text;
                grid.DefaultCellStyle.BackColor = theme.Surface;
                grid.DefaultCellStyle.ForeColor = theme.TextMuted;
                grid.DefaultCellStyle.SelectionBackColor = theme.SelectionBack;
                grid.DefaultCellStyle.SelectionForeColor = theme.SelectionText;
                grid.RowsDefaultCellStyle.BackColor = theme.Surface;
                grid.RowsDefaultCellStyle.ForeColor = theme.TextMuted;
                grid.AlternatingRowsDefaultCellStyle.BackColor = theme.IsDark ? Color.FromArgb(31, 38, 48) : Color.FromArgb(250, 252, 254);
                grid.AlternatingRowsDefaultCellStyle.ForeColor = theme.TextMuted;
                grid.AlternatingRowsDefaultCellStyle.SelectionBackColor = theme.SelectionBack;
                grid.AlternatingRowsDefaultCellStyle.SelectionForeColor = theme.SelectionText;
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
    }
}
