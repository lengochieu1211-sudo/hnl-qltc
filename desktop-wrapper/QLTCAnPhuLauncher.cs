using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace QLTCAnPhu
{
    internal static class Program
    {
        private const string AppBaseUrl = "https://hnlqltc.web.app/?app=desktop";
        private const string ProductName = "HNL QLTC Windows Desktop Suite";
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

            internal DesktopSuiteForm()
            {
                Text = Program.ProductName;
                StartPosition = FormStartPosition.CenterScreen;
                MinimumSize = new Size(780, 540);
                Size = new Size(920, 640);
                Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
                BackColor = Color.FromArgb(246, 248, 251);

                try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

                var root = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 4,
                    Padding = new Padding(24),
                    BackColor = BackColor
                };
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 104));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
                Controls.Add(root);

                var header = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(18, 14, 18, 12) };
                root.Controls.Add(header, 0, 0);

                var title = new Label
                {
                    AutoSize = true,
                    Text = "HNL QLTC Windows Desktop Suite",
                    Font = new Font("Segoe UI", 20F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(25, 46, 80),
                    Location = new Point(18, 14)
                };
                header.Controls.Add(title);

                var subtitle = new Label
                {
                    AutoSize = true,
                    Text = "Trung tâm Windows cho HNL Quản Lý Thi Công",
                    Font = new Font("Segoe UI", 10F, FontStyle.Regular),
                    ForeColor = Color.FromArgb(88, 99, 115),
                    Location = new Point(21, 57)
                };
                header.Controls.Add(subtitle);

                var version = new Label
                {
                    AutoSize = true,
                    Text = "Build " + Program.GetReleaseTag(),
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(68, 78, 92),
                    Anchor = AnchorStyles.Top | AnchorStyles.Right
                };
                header.Controls.Add(version);
                version.Location = new Point(Math.Max(20, header.Width - version.Width - 18), 18);
                header.Resize += delegate { version.Location = new Point(Math.Max(20, header.Width - version.Width - 18), 18); };

                var openPanel = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 3,
                    Padding = new Padding(0, 14, 0, 8)
                };
                openPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                openPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
                openPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
                root.Controls.Add(openPanel, 0, 1);

                var openApp = MakePrimaryButton("Mở HNL QLTC");
                openApp.Click += delegate { SafeAction(Program.OpenHnlQltc); };
                openPanel.Controls.Add(openApp, 0, 0);

                var openWorkspace = MakeSecondaryButton("Mở Workspace");
                openWorkspace.Click += delegate { SafeAction(delegate { OpenFolder(DesktopPaths.WorkspaceRoot); }); };
                openPanel.Controls.Add(openWorkspace, 1, 0);

                var runDiagnostics = MakeSecondaryButton("Chẩn đoán hệ thống");
                runDiagnostics.Click += delegate { RunDiagnostics(); };
                openPanel.Controls.Add(runDiagnostics, 2, 0);

                var cards = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 2,
                    RowCount = 2,
                    Padding = new Padding(0, 8, 0, 8)
                };
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                root.Controls.Add(cards, 0, 2);

                cards.Controls.Add(BuildCard(
                    "Đồng bộ & Backup",
                    "Workspace cục bộ chỉ là vùng làm việc/cache. Firestore và R2 vẫn là nguồn dữ liệu cloud chính.",
                    new[] {
                        new CardAction("Mở thư mục Backup", DesktopPaths.Backup),
                        new CardAction("Mở thư mục Import", DesktopPaths.Imports)
                    }), 0, 0);

                cards.Controls.Add(BuildCard(
                    "Xuất hồ sơ",
                    "Tách riêng thư mục Excel, PDF và báo cáo để dễ lưu trữ, bàn giao và kiểm soát phiên bản.",
                    new[] {
                        new CardAction("Excel", DesktopPaths.Excel),
                        new CardAction("PDF", DesktopPaths.Pdf),
                        new CardAction("Reports", DesktopPaths.Reports)
                    }), 1, 0);

                cards.Controls.Add(BuildCard(
                    "Local Workspace & Queue",
                    "SQLite chỉ lưu mirror/cache. Ảnh đúng cấu trúc Photos/<project>/<loại>/<entity>/<category>/... được bàn giao qua Web app Auth/RBAC; EXE không tự ghi cloud.",
                    new[] {
                        new CardAction("Mở Sync Center", delegate { OpenSyncCenter(); }),
                        new CardAction("Mở Photos", DesktopPaths.Photos),
                        new CardAction("Quét lại chỉ mục", delegate { RefreshLocalIndex(true); })
                    }), 0, 1);

                cards.Controls.Add(BuildCard(
                    "Chẩn đoán & Nhật ký",
                    "Kiểm tra Hosting, R2, AI Gateway, trình duyệt, ổ đĩa và xuất snapshot để gửi hỗ trợ kỹ thuật.",
                    new[] {
                        new CardAction("Diagnostics", DesktopPaths.Diagnostics),
                        new CardAction("Logs", DesktopPaths.Logs)
                    }), 1, 1);

                var footer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
                footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
                root.Controls.Add(footer, 0, 3);

                statusLabel = new Label
                {
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.MiddleLeft,
                    Text = "Sẵn sàng. Chưa thực hiện thay đổi dữ liệu cloud.",
                    ForeColor = Color.FromArgb(75, 86, 101)
                };
                footer.Controls.Add(statusLabel, 0, 0);

                browserLabel = new Label
                {
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.MiddleRight,
                    ForeColor = Color.FromArgb(75, 86, 101)
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
                menu.Items.Add("Mở Desktop Suite", null, delegate { RestoreFromTray(); });
                menu.Items.Add("Mở HNL QLTC", null, delegate { SafeAction(Program.OpenHnlQltc); });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Thoát", null, delegate { allowClose = true; Close(); });
                trayIcon.ContextMenuStrip = menu;
                trayIcon.DoubleClick += delegate { RestoreFromTray(); };

                Resize += delegate
                {
                    if (WindowState == FormWindowState.Minimized)
                    {
                        Hide();
                        trayIcon.ShowBalloonTip(1500, "HNL QLTC", "Desktop Suite vẫn đang chạy ở khay hệ thống.", ToolTipIcon.Info);
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

                FormClosed += delegate {
                    backgroundTimer.Stop();
                    backgroundTimer.Dispose();
                    localStore.Dispose();
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                };
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
                    BackColor = Color.FromArgb(24, 86, 164),
                    ForeColor = Color.White,
                    Font = new Font("Segoe UI", 11F, FontStyle.Bold),
                    Cursor = Cursors.Hand
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
                    BackColor = Color.White,
                    ForeColor = Color.FromArgb(38, 61, 92),
                    Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                    Cursor = Cursors.Hand
                };
            }

            private Panel BuildCard(string title, string description, CardAction[] actions)
            {
                var card = new Panel
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(6),
                    Padding = new Padding(18),
                    BackColor = Color.White
                };

                var heading = new Label
                {
                    Dock = DockStyle.Top,
                    Height = 30,
                    Text = title,
                    Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(31, 53, 82)
                };
                card.Controls.Add(heading);

                var desc = new Label
                {
                    Dock = DockStyle.Top,
                    Height = 62,
                    Text = description,
                    ForeColor = Color.FromArgb(92, 103, 118)
                };
                card.Controls.Add(desc);
                desc.BringToFront();

                var actionPanel = new FlowLayoutPanel
                {
                    Dock = DockStyle.Bottom,
                    Height = 42,
                    FlowDirection = FlowDirection.LeftToRight,
                    WrapContents = false,
                    AutoScroll = true
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
                        BackColor = Color.FromArgb(247, 249, 252),
                        ForeColor = Color.FromArgb(40, 66, 99),
                        Cursor = Cursors.Hand
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
                string browserText = browser == null ? "Windows default" : browser.DisplayName;
                if (localStore == null || !localStore.IsReady)
                {
                    browserLabel.Text = "SQLite: lỗi | " + browserText;
                    return;
                }
                browserLabel.Text = "SQLite: " + localStore.CountIndexedFiles() + " file | Queue: " + localStore.CountQueuePending() + " chờ / " + localStore.CountQueueReady() + " Web / " + localStore.CountQueueCompleted() + " xong | " + browserText;
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
                    statusLabel.Text = "Local index: " + result.IndexedFiles + " file, queue mới " + result.EnqueuedFiles + ". Cloud chưa bị thay đổi.";
                    if (showMessage)
                    {
                        MessageBox.Show(
                            "Đã cập nhật SQLite local index.\n\nFile: " + result.IndexedFiles +
                            "\nQueue mới: " + result.EnqueuedFiles +
                            "\nFile cũ đã loại khỏi index: " + result.RemovedFiles +
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
    }
}