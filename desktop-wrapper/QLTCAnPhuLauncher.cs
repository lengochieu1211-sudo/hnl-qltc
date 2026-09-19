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
                Application.Run(new DesktopSuiteForm());
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

            internal static void EnsureWorkspace()
            {
                string[] dirs = { WorkspaceRoot, Backup, Imports, Exports, Excel, Pdf, Reports, Photos, Diagnostics, DesktopBridge, DesktopBridgeAcks, LocalState, Logs, DesktopSuiteState };
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
                Size = new Size(1220, 820);
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
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 118));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 156));
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
                Controls.Add(root);

                var header = new Panel
                {
                    Dock = DockStyle.Fill,
                    Padding = new Padding(22, 18, 22, 18),
                    Margin = new Padding(0, 0, 0, 14),
                    Tag = "header"
                };
                root.Controls.Add(header, 0, 0);

                if (Icon != null)
                {
                    var logo = new PictureBox
                    {
                        Size = new Size(58, 58),
                        Location = new Point(0, 6),
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
                    Font = new Font("Segoe UI", 22F, FontStyle.Bold),
                    Location = new Point(74, 8),
                    Tag = "title"
                };
                header.Controls.Add(title);

                var subtitle = new Label
                {
                    AutoSize = true,
                    Text = "Trung tâm làm việc trên Windows cho HNL Quản Lý Thi Công",
                    Font = new Font("Segoe UI", 10F, FontStyle.Regular),
                    Location = new Point(78, 50),
                    Tag = "muted"
                };
                header.Controls.Add(subtitle);

                var themeMode = new Label
                {
                    AutoSize = true,
                    Text = "Giao diện: Tự động theo hệ thống",
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    Location = new Point(78, 76),
                    Tag = "subtle"
                };
                header.Controls.Add(themeMode);

                var versionBadge = new Label
                {
                    AutoSize = true,
                    Text = "Build " + Program.GetReleaseTag(),
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    Padding = new Padding(12, 8, 12, 8),
                    Tag = "badge"
                };
                header.Controls.Add(versionBadge);
                Action positionHeaderBadges = delegate
                {
                    versionBadge.Location = new Point(Math.Max(20, header.Width - versionBadge.Width - 18), 14);
                };
                header.Resize += delegate { positionHeaderBadges(); };
                positionHeaderBadges();

                var hero = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 2,
                    Padding = new Padding(0),
                    Margin = new Padding(0, 0, 0, 14),
                    Tag = "root"
                };
                hero.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 56F));
                hero.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44F));
                root.Controls.Add(hero, 0, 1);

                var welcomeCard = new Panel
                {
                    Dock = DockStyle.Fill,
                    Padding = new Padding(22, 18, 22, 18),
                    Margin = new Padding(0, 0, 10, 0),
                    Tag = "card"
                };
                hero.Controls.Add(welcomeCard, 0, 0);

                var welcomeTitle = new Label
                {
                    AutoSize = true,
                    Text = "Sẵn sàng mở dự án và làm việc",
                    Font = new Font("Segoe UI", 15F, FontStyle.Bold),
                    Location = new Point(0, 0),
                    Tag = "section-title"
                };
                welcomeCard.Controls.Add(welcomeTitle);

                var welcomeText = new Label
                {
                    AutoSize = false,
                    Width = 560,
                    Height = 72,
                    Text = "Mở nhanh HNL QLTC bằng chế độ app desktop, giữ profile trình duyệt riêng, đồng thời theo dõi dữ liệu local, ảnh hiện trường và trạng thái đồng bộ mà không làm rối giao diện.",
                    Location = new Point(0, 34),
                    Tag = "body"
                };
                welcomeCard.Controls.Add(welcomeText);

                var bullet = new Label
                {
                    AutoSize = false,
                    Width = 560,
                    Height = 54,
                    Text = "• Gọn cho người dùng thường ngày
• Có dark mode theo Windows
• Giữ nguyên Local Workspace, Queue và cơ chế sync đã certified",
                    Location = new Point(0, 98),
                    Tag = "subtle"
                };
                welcomeCard.Controls.Add(bullet);

                var actionCard = new Panel
                {
                    Dock = DockStyle.Fill,
                    Padding = new Padding(20, 18, 20, 18),
                    Margin = new Padding(10, 0, 0, 0),
                    Tag = "card"
                };
                hero.Controls.Add(actionCard, 1, 0);

                var actionTitle = new Label
                {
                    AutoSize = true,
                    Text = "Thao tác nhanh",
                    Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                    Location = new Point(0, 0),
                    Tag = "section-title"
                };
                actionCard.Controls.Add(actionTitle);

                var actionButtons = new TableLayoutPanel
                {
                    Location = new Point(0, 34),
                    Size = new Size(420, 96),
                    ColumnCount = 2,
                    RowCount = 2,
                    Tag = "root"
                };
                actionButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                actionButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                actionButtons.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
                actionButtons.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
                actionCard.Controls.Add(actionButtons);

                var openApp = MakePrimaryButton("Mở HNL QLTC");
                openApp.Click += delegate { SafeAction(Program.OpenHnlQltc); };
                actionButtons.Controls.Add(openApp, 0, 0);
                actionButtons.SetColumnSpan(openApp, 2);

                var openWorkspace = MakeSecondaryButton("Mở thư mục dữ liệu");
                openWorkspace.Click += delegate { SafeAction(delegate { OpenFolder(DesktopPaths.WorkspaceRoot); }); };
                actionButtons.Controls.Add(openWorkspace, 0, 1);

                var openSync = MakeSecondaryButton("Sync Center");
                openSync.Click += delegate { OpenSyncCenter(); };
                actionButtons.Controls.Add(openSync, 1, 1);

                var cards = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 2,
                    RowCount = 2,
                    Padding = new Padding(0),
                    Margin = new Padding(0),
                    Tag = "root"
                };
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
                root.Controls.Add(cards, 0, 2);

                cards.Controls.Add(BuildCard(
                    "Dữ liệu & Sao lưu",
                    "Mở nhanh khu vực Backup và Imports. Dữ liệu cloud của dự án vẫn là nguồn chính; vùng local chỉ hỗ trợ làm việc và cache an toàn.",
                    new[] {
                        new CardAction("Mở Backup", DesktopPaths.Backup),
                        new CardAction("Mở Imports", DesktopPaths.Imports)
                    }), 0, 0);

                cards.Controls.Add(BuildCard(
                    "Xuất hồ sơ",
                    "Tập trung toàn bộ hồ sơ xuất từ desktop: Excel, PDF và Reports để bàn giao, kiểm tra hoặc lưu trữ theo đợt.",
                    new[] {
                        new CardAction("Excel", DesktopPaths.Excel),
                        new CardAction("PDF", DesktopPaths.Pdf),
                        new CardAction("Reports", DesktopPaths.Reports)
                    }), 1, 0);

                cards.Controls.Add(BuildCard(
                    "Ảnh hiện trường & đồng bộ",
                    "Quản lý ảnh lưu trên máy, xem trạng thái queue/history, retry có kiểm soát và tiếp tục đồng bộ qua web app khi cần.",
                    new[] {
                        new CardAction("Mở Photos", DesktopPaths.Photos),
                        new CardAction("Mở Sync Center", delegate { OpenSyncCenter(); })
                    }), 0, 1);

                cards.Controls.Add(BuildCard(
                    "Hỗ trợ & công cụ",
                    "Chẩn đoán hệ thống, mở logs, quét lại chỉ mục và các công cụ hỗ trợ kỹ thuật được gom riêng để giao diện chính gọn hơn.",
                    new[] {
                        new CardAction("Công cụ nâng cao", delegate { OpenAdvancedTools(); }),
                        new CardAction("Logs", DesktopPaths.Logs)
                    }), 1, 1);

                var footer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Tag = "root" };
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42F));
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58F));
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
                    Margin = new Padding(0, 0, 8, 0),
                    Text = text,
                    Height = 52,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 11F, FontStyle.Bold),
                    Cursor = Cursors.Hand,
                    Tag = "primary"
                };
            }

            private Button MakeSecondaryButton(string text)
            {
                return new Button
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(8, 0, 0, 0),
                    Text = text,
                    Height = 52,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 10F, FontStyle.Bold),
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

                var heading = new Label
                {
                    Dock = DockStyle.Top,
                    Height = 30,
                    Text = title,
                    Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                    Tag = "section-title"
                };
                card.Controls.Add(heading);

                var desc = new Label
                {
                    Dock = DockStyle.Top,
                    Height = 68,
                    Text = description,
                    Tag = "body"
                };
                card.Controls.Add(desc);
                desc.BringToFront();

                var actionPanel = new FlowLayoutPanel
                {
                    Dock = DockStyle.Bottom,
                    Height = 44,
                    FlowDirection = FlowDirection.LeftToRight,
                    WrapContents = false,
                    AutoScroll = true,
                    Tag = "root"
                };
                card.Controls.Add(actionPanel);

                foreach (CardAction action in actions)
                {
                    var button = new Button
                    {
                        AutoSize = true,
                        Height = 34,
                        Text = action.Caption,
                        FlatStyle = FlatStyle.Flat,
                        Cursor = Cursors.Hand,
                        Margin = new Padding(0, 0, 8, 0),
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
                    form.Tag = "root";
                    try { form.Icon = Icon; } catch { }

                    var root = new TableLayoutPanel
                    {
                        Dock = DockStyle.Fill,
                        RowCount = 3,
                        ColumnCount = 1,
                        Padding = new Padding(22),
                        Tag = "root"
                    };
                    root.RowStyles.Add(new RowStyle(SizeType.Absolute, 92F));
                    root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
                    root.RowStyles.Add(new RowStyle(SizeType.Absolute, 60F));
                    form.Controls.Add(root);

                    var header = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18, 16, 18, 14), Tag = "card" };
                    root.Controls.Add(header, 0, 0);
                    var title = new Label
                    {
                        AutoSize = true,
                        Text = "Hỗ trợ & công cụ nâng cao",
                        Font = new Font("Segoe UI", 18F, FontStyle.Bold),
                        Location = new Point(0, 0),
                        Tag = "title"
                    };
                    header.Controls.Add(title);
                    var desc = new Label
                    {
                        AutoSize = false,
                        Width = 660,
                        Height = 42,
                        Text = "Dành cho quản trị hoặc hỗ trợ kỹ thuật. Các tính năng kỹ thuật được gom riêng để người dùng hằng ngày chỉ thấy giao diện đơn giản, gọn và dễ dùng.",
                        Location = new Point(0, 38),
                        Tag = "body"
                    };
                    header.Controls.Add(desc);

                    var tools = new TableLayoutPanel
                    {
                        ColumnCount = 2,
                        RowCount = 3,
                        Dock = DockStyle.Fill,
                        Tag = "root"
                    };
                    tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                    tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
                    for (int i = 0; i < 3; i++) tools.RowStyles.Add(new RowStyle(SizeType.Percent, 33.333F));
                    root.Controls.Add(tools, 0, 1);

                    AddAdvancedToolButton(tools, "Mở Workspace", delegate { OpenFolder(DesktopPaths.WorkspaceRoot); }, 0, 0);
                    AddAdvancedToolButton(tools, "Trung tâm đồng bộ", delegate { OpenSyncCenter(); }, 1, 0);
                    AddAdvancedToolButton(tools, "Quét lại chỉ mục", delegate { RefreshLocalIndex(true); }, 0, 1);
                    AddAdvancedToolButton(tools, "Chẩn đoán hệ thống", delegate { RunDiagnostics(); }, 1, 1);
                    AddAdvancedToolButton(tools, "Thư mục Diagnostics", delegate { OpenFolder(DesktopPaths.Diagnostics); }, 0, 2);
                    AddAdvancedToolButton(tools, "Nhật ký kỹ thuật", delegate { OpenFolder(DesktopPaths.Logs); }, 1, 2);

                    var note = new Label
                    {
                        Dock = DockStyle.Fill,
                        Text = "SQLite, Queue, R2 và các chi tiết đồng bộ kỹ thuật vẫn được giữ nguyên ở lớp nền; giao diện chính chỉ hiển thị trạng thái dễ hiểu cho người dùng thông thường.",
                        TextAlign = ContentAlignment.MiddleLeft,
                        Tag = "muted"
                    };
                    root.Controls.Add(note, 0, 2);

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
                            "Đã cập nhật SQLite local index.

File: " + result.IndexedFiles +
                            "
Queue mới: " + result.EnqueuedFiles +
                            "
File cũ đã loại khỏi index: " + result.RemovedFiles +
                            (result.ScanIncomplete ? "
Cảnh báo: scan chưa đầy đủ; không xóa stale index/queue trong lượt này." : "") +
                            "

Không có dữ liệu cloud nào bị sửa.",
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
                        "Đã tạo báo cáo chẩn đoán chỉ-đọc.

" + path +
                        "

Hosting: " + hosting +
                        "
R2: " + r2 +
                        "
AI Gateway: " + ai,
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
                sb.Append("  "").Append(JsonEscape(key)).Append("": "").Append(JsonEscape(value)).Append(""");
                if (comma) sb.Append(',');
                sb.AppendLine();
            }

            private static string JsonEscape(string value)
            {
                if (value == null) return "";
                return value.Replace("\", "\\").Replace(""", "\"").Replace("
", "\r").Replace("
", "\n");
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
