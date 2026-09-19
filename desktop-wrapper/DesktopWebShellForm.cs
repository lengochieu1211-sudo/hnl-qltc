using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace QLTCAnPhu
{
    internal sealed class DesktopWebShellForm : Form
    {
        internal static DesktopWebShellForm Current { get; private set; }

        private readonly Panel contentHost;
        private readonly Panel webHost;
        private readonly Panel homeHost;
        private readonly Label webStatusLabel;
        private readonly Label syncStatusLabel;
        private readonly DesktopLocalStore localStore;
        private readonly NotifyIcon trayIcon;
        private readonly System.Windows.Forms.Timer maintenanceTimer;
        private readonly ContextMenuStrip moreMenu;
        private Program.DesktopUiTheme theme;
        private EmbeddedWebViewRuntime embeddedRuntime;
        private bool webInitializationStarted;
        private bool allowClose;
        private int maintenanceRunning;

        internal DesktopWebShellForm()
        {
            Current = this;
            theme = Program.DesktopUiTheme.ReadFromSystem();

            Text = "HNL QLTC";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(980, 680);
            Size = new Size(1280, 820);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 3,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 68F));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34F));
            Controls.Add(root);

            var toolbar = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(16, 10, 16, 10),
                Margin = new Padding(0),
                Tag = "header"
            };
            root.Controls.Add(toolbar, 0, 0);

            if (Icon != null)
            {
                toolbar.Controls.Add(new PictureBox
                {
                    Size = new Size(42, 42),
                    Location = new Point(16, 13),
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Image = Icon.ToBitmap(),
                    BackColor = Color.Transparent
                });
            }

            var brand = new Label
            {
                AutoSize = true,
                Text = "HNL QLTC",
                Font = new Font("Segoe UI", 15F, FontStyle.Bold),
                Location = new Point(68, 12),
                Tag = "title"
            };
            toolbar.Controls.Add(brand);

            var release = new Label
            {
                AutoSize = true,
                Text = Program.GetReleaseTag(),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                Location = new Point(70, 40),
                Tag = "subtle"
            };
            toolbar.Controls.Add(release);

            var nav = new FlowLayoutPanel
            {
                AutoSize = true,
                Height = 46,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Location = new Point(220, 11),
                Tag = "header"
            };
            toolbar.Controls.Add(nav);

            var backButton = MakeToolbarButton("←", 42);
            backButton.Click += delegate { if (embeddedRuntime != null) embeddedRuntime.GoBack(); };
            nav.Controls.Add(backButton);

            var forwardButton = MakeToolbarButton("→", 42);
            forwardButton.Click += delegate { if (embeddedRuntime != null) embeddedRuntime.GoForward(); };
            nav.Controls.Add(forwardButton);

            var homeButton = MakeToolbarButton("Trang chủ", 100);
            homeButton.Click += delegate { ShowHome(); };
            nav.Controls.Add(homeButton);

            var appButton = MakeToolbarPrimaryButton("HNL QLTC", 112);
            appButton.Click += delegate { ShowWebApp(); };
            nav.Controls.Add(appButton);

            var syncButton = MakeToolbarButton("Đồng bộ", 100);
            syncButton.Click += delegate { OpenSyncCenter(); };
            nav.Controls.Add(syncButton);

            var reloadButton = MakeToolbarButton("↻ Tải lại", 92);
            reloadButton.Click += delegate
            {
                ShowWebApp();
                if (embeddedRuntime != null) embeddedRuntime.Reload();
            };
            nav.Controls.Add(reloadButton);

            var moreButton = MakeToolbarButton("⋯", 46);
            nav.Controls.Add(moreButton);

            moreMenu = BuildMoreMenu();
            moreButton.Click += delegate
            {
                moreMenu.Show(moreButton, new Point(0, moreButton.Height));
            };

            contentHost = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            root.Controls.Add(contentHost, 0, 1);

            webHost = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            contentHost.Controls.Add(webHost);

            homeHost = BuildHomePanel();
            homeHost.Dock = DockStyle.Fill;
            contentHost.Controls.Add(homeHost);

            var footer = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(14, 0, 14, 0),
                Margin = new Padding(0),
                Tag = "root"
            };
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55F));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45F));
            root.Controls.Add(footer, 0, 2);

            webStatusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Text = "Đang chuẩn bị HNL QLTC...",
                Tag = "muted"
            };
            footer.Controls.Add(webStatusLabel, 0, 0);

            syncStatusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleRight,
                Text = "Đồng bộ: đang kiểm tra",
                Tag = "muted"
            };
            footer.Controls.Add(syncStatusLabel, 1, 0);

            Program.DesktopPaths.EnsureWorkspace();
            localStore = DesktopLocalStore.TryOpen(Program.DesktopPaths.LocalDatabase);
            RefreshSyncStatus();

            trayIcon = new NotifyIcon
            {
                Text = "HNL QLTC",
                Visible = true,
                Icon = Icon
            };
            var trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Mở HNL QLTC", null, delegate { RestoreFromTray(); ShowWebApp(); });
            trayMenu.Items.Add("Trang chủ Windows", null, delegate { RestoreFromTray(); ShowHome(); });
            trayMenu.Items.Add("Sync Center", null, delegate { RestoreFromTray(); OpenSyncCenter(); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Thoát", null, delegate { allowClose = true; Close(); });
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.DoubleClick += delegate { RestoreFromTray(); ShowWebApp(); };

            maintenanceTimer = new System.Windows.Forms.Timer { Interval = 30000 };
            maintenanceTimer.Tick += delegate { RunBackgroundMaintenance(); };
            maintenanceTimer.Start();

            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    Hide();
                    trayIcon.ShowBalloonTip(1200, "HNL QLTC", "Ứng dụng vẫn đang chạy ở khay hệ thống.", ToolTipIcon.Info);
                }
            };

            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (!allowClose && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    Hide();
                    trayIcon.ShowBalloonTip(1200, "HNL QLTC", "Đã thu nhỏ xuống khay hệ thống. Chọn Thoát để đóng hoàn toàn.", ToolTipIcon.Info);
                }
            };

            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
            Shown += delegate
            {
                ApplyTheme();
                BeginInvoke((MethodInvoker)delegate { ShowWebApp(); });
            };
            FormClosed += delegate
            {
                maintenanceTimer.Stop();
                maintenanceTimer.Dispose();
                if (embeddedRuntime != null) embeddedRuntime.Dispose();
                localStore.Dispose();
                trayIcon.Visible = false;
                trayIcon.Dispose();
                moreMenu.Dispose();
                SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
                if (ReferenceEquals(Current, this)) Current = null;
            };
        }

        internal void ShowWebApp()
        {
            if (InvokeRequired)
            {
                BeginInvoke((MethodInvoker)ShowWebApp);
                return;
            }

            webHost.BringToFront();
            if (!webInitializationStarted)
            {
                InitializeEmbeddedWeb();
                return;
            }

            if (embeddedRuntime != null && embeddedRuntime.IsReady)
            {
                embeddedRuntime.Navigate(Program.BuildAppUrl());
                webStatusLabel.Text = "HNL QLTC đang chạy bên trong ứng dụng Windows.";
            }
        }

        private void InitializeEmbeddedWeb()
        {
            webInitializationStarted = true;
            webHost.Controls.Clear();
            webStatusLabel.Text = "Đang khởi tạo WebView2...";

            try
            {
                embeddedRuntime = new EmbeddedWebViewRuntime(
                    webHost,
                    Program.DesktopPaths.WebView2Profile,
                    Program.BuildAppUrl(),
                    delegate(string message)
                    {
                        try
                        {
                            if (IsDisposed) return;
                            BeginInvoke((MethodInvoker)delegate
                            {
                                webStatusLabel.Text = message;
                                RefreshSyncStatus();
                            });
                        }
                        catch { }
                    },
                    delegate(string error)
                    {
                        try
                        {
                            if (IsDisposed) return;
                            BeginInvoke((MethodInvoker)delegate { ShowWebViewFailure(error); });
                        }
                        catch { }
                    }
                );
                embeddedRuntime.Start();
            }
            catch (Exception ex)
            {
                ShowWebViewFailure(ex.Message);
            }
        }

        private void ShowWebViewFailure(string error)
        {
            webHost.Controls.Clear();
            var card = new Panel
            {
                Width = 680,
                Height = 300,
                Padding = new Padding(28),
                Tag = "card"
            };
            webHost.Controls.Add(card);

            Action centerCard = delegate
            {
                card.Location = new Point(
                    Math.Max(18, (webHost.ClientSize.Width - card.Width) / 2),
                    Math.Max(18, (webHost.ClientSize.Height - card.Height) / 2)
                );
            };
            webHost.Resize += delegate { centerCard(); };
            centerCard();

            var title = new Label
            {
                AutoSize = true,
                Text = "Không thể khởi tạo chế độ nhúng WebView2",
                Font = new Font("Segoe UI", 16F, FontStyle.Bold),
                Location = new Point(28, 28),
                Tag = "title"
            };
            card.Controls.Add(title);

            var body = new Label
            {
                AutoSize = false,
                Width = 610,
                Height = 100,
                Text = "HNL QLTC ưu tiên chạy ngay bên trong EXE để không mở tab trình duyệt mới.\r\n\r\n" +
                       "WebView2 chưa sẵn sàng trên máy này. Bạn có thể thử lại hoặc dùng trình duyệt làm phương án dự phòng.\r\n" +
                       "Chi tiết: " + error,
                Location = new Point(28, 74),
                Tag = "body"
            };
            card.Controls.Add(body);

            var retry = MakeToolbarPrimaryButton("Thử lại WebView2", 160);
            retry.Location = new Point(28, 205);
            retry.Click += delegate
            {
                if (embeddedRuntime != null) embeddedRuntime.Dispose();
                embeddedRuntime = null;
                webInitializationStarted = false;
                InitializeEmbeddedWeb();
            };
            card.Controls.Add(retry);

            var browser = MakeToolbarButton("Mở bằng trình duyệt", 170);
            browser.Location = new Point(202, 205);
            browser.Click += delegate { Program.OpenHnlQltcExternal(); };
            card.Controls.Add(browser);

            Program.DesktopUiTheme.ApplyToForm(this, theme);
            webStatusLabel.Text = "WebView2 chưa sẵn sàng • Trình duyệt chỉ là phương án dự phòng.";
        }

        private Panel BuildHomePanel()
        {
            var panel = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(28),
                Tag = "root"
            };

            var heading = new Label
            {
                AutoSize = true,
                Text = "Trung tâm Windows",
                Font = new Font("Segoe UI", 22F, FontStyle.Bold),
                Location = new Point(28, 24),
                Tag = "title"
            };
            panel.Controls.Add(heading);

            var sub = new Label
            {
                AutoSize = true,
                Text = "Các công cụ local được giữ riêng; HNL QLTC Web chạy trực tiếp trong EXE.",
                Location = new Point(31, 66),
                Tag = "muted"
            };
            panel.Controls.Add(sub);

            var grid = new TableLayoutPanel
            {
                Location = new Point(28, 112),
                Size = new Size(1100, 430),
                ColumnCount = 2,
                RowCount = 2,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom,
                Tag = "root"
            };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
            panel.Controls.Add(grid);

            panel.Resize += delegate
            {
                grid.Size = new Size(Math.Max(600, panel.ClientSize.Width - 56), Math.Max(320, panel.ClientSize.Height - 150));
            };

            grid.Controls.Add(BuildHomeCard("Dữ liệu & Sao lưu", "Backup và Imports được lưu riêng trong Documents\\HNL QLTC.", new[]
            {
                new HomeAction("Backup", delegate { OpenFolder(Program.DesktopPaths.Backup); }),
                new HomeAction("Imports", delegate { OpenFolder(Program.DesktopPaths.Imports); })
            }), 0, 0);

            grid.Controls.Add(BuildHomeCard("Xuất hồ sơ", "Mở nhanh Excel, PDF và Reports của HNL QLTC.", new[]
            {
                new HomeAction("Excel", delegate { OpenFolder(Program.DesktopPaths.Excel); }),
                new HomeAction("PDF", delegate { OpenFolder(Program.DesktopPaths.Pdf); }),
                new HomeAction("Reports", delegate { OpenFolder(Program.DesktopPaths.Reports); })
            }), 1, 0);

            grid.Controls.Add(BuildHomeCard("Ảnh hiện trường & đồng bộ", "Ảnh local, queue/history và thao tác retry được giữ trong Sync Center.", new[]
            {
                new HomeAction("Photos", delegate { OpenFolder(Program.DesktopPaths.Photos); }),
                new HomeAction("Sync Center", delegate { OpenSyncCenter(); })
            }), 0, 1);

            grid.Controls.Add(BuildHomeCard("Hỗ trợ & chẩn đoán", "Công cụ kỹ thuật được gom riêng để không làm rối giao diện làm việc chính.", new[]
            {
                new HomeAction("Diagnostics", delegate { OpenFolder(Program.DesktopPaths.Diagnostics); }),
                new HomeAction("Logs", delegate { OpenFolder(Program.DesktopPaths.Logs); }),
                new HomeAction("Trình duyệt dự phòng", delegate { Program.OpenHnlQltcExternal(); })
            }), 1, 1);

            return panel;
        }

        private Panel BuildHomeCard(string title, string description, HomeAction[] actions)
        {
            var card = new Panel
            {
                Dock = DockStyle.Fill,
                Margin = new Padding(8),
                Padding = new Padding(20),
                Tag = "card"
            };

            card.Controls.Add(new Label
            {
                Dock = DockStyle.Top,
                Height = 32,
                Text = title,
                Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                Tag = "section-title"
            });

            card.Controls.Add(new Label
            {
                Dock = DockStyle.Top,
                Height = 70,
                Text = description,
                Tag = "body"
            });

            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                Height = 44,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Tag = "card"
            };
            card.Controls.Add(buttons);

            foreach (HomeAction action in actions)
            {
                var button = MakeToolbarButton(action.Caption, 0);
                button.AutoSize = true;
                button.Height = 34;
                button.Click += delegate { SafeAction(action.Handler); };
                buttons.Controls.Add(button);
            }

            return card;
        }

        private ContextMenuStrip BuildMoreMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Mở bằng trình duyệt", null, delegate { Program.OpenHnlQltcExternal(); });
            menu.Items.Add("Mở Backup", null, delegate { OpenFolder(Program.DesktopPaths.Backup); });
            menu.Items.Add("Mở Photos", null, delegate { OpenFolder(Program.DesktopPaths.Photos); });
            menu.Items.Add("Mở Logs", null, delegate { OpenFolder(Program.DesktopPaths.Logs); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sync Center", null, delegate { OpenSyncCenter(); });
            menu.Items.Add("Quét lại dữ liệu local", null, delegate { RefreshLocalIndex(true); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Thoát", null, delegate { allowClose = true; Close(); });
            return menu;
        }

        private Button MakeToolbarButton(string text, int width)
        {
            var button = new Button
            {
                Text = text,
                Height = 40,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Margin = new Padding(4, 1, 4, 1),
                Tag = "secondary"
            };
            if (width > 0) button.Width = width;
            return button;
        }

        private Button MakeToolbarPrimaryButton(string text, int width)
        {
            Button button = MakeToolbarButton(text, width);
            button.Tag = "primary";
            return button;
        }

        private void ShowHome()
        {
            homeHost.BringToFront();
            webStatusLabel.Text = "Trung tâm Windows • HNL QLTC Web vẫn được giữ sẵn ở nền.";
        }

        private void OpenSyncCenter()
        {
            if (localStore == null || !localStore.IsReady)
            {
                MessageBox.Show("Dữ liệu local chưa sẵn sàng.", "HNL QLTC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            using (var form = new DesktopSyncCenterForm(localStore, Program.DesktopPaths.WorkspaceRoot))
            {
                form.ShowDialog(this);
            }
            RefreshSyncStatus();
        }

        private void RefreshSyncStatus()
        {
            if (localStore == null || !localStore.IsReady)
            {
                syncStatusLabel.Text = "Dữ liệu cục bộ: cần kiểm tra";
                return;
            }

            int waiting = localStore.CountQueuePending() + localStore.CountQueueReady();
            syncStatusLabel.Text = waiting == 0
                ? "Dữ liệu cục bộ: Bình thường • Đồng bộ: Đã hoàn tất"
                : "Dữ liệu cục bộ: Bình thường • Đồng bộ: Còn " + waiting + " mục";
        }

        private void RefreshLocalIndex(bool showMessage)
        {
            if (localStore == null || !localStore.IsReady) return;
            try
            {
                WorkspaceIndexResult result = localStore.RefreshIndex(Program.DesktopPaths.WorkspaceRoot);
                RefreshSyncStatus();
                if (showMessage)
                {
                    MessageBox.Show(
                        "Đã cập nhật dữ liệu local.\n\nFile: " + result.IndexedFiles + "\nQueue mới: " + result.EnqueuedFiles,
                        "HNL QLTC",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }
            }
            catch (Exception ex)
            {
                if (showMessage) MessageBox.Show(ex.Message, "HNL QLTC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
                    localStore.RefreshIndex(Program.DesktopPaths.WorkspaceRoot);
                    localStore.ProcessOneQueueItem(Program.DesktopPaths.WorkspaceRoot);
                    localStore.RefreshBridgeManifest(Program.DesktopPaths.WorkspaceRoot);
                    localStore.RunRetentionMaintenanceIfDue();
                }
                catch { }
                finally
                {
                    Interlocked.Exchange(ref maintenanceRunning, 0);
                    try { BeginInvoke((MethodInvoker)RefreshSyncStatus); } catch { }
                }
            });
        }

        private void RestoreFromTray()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category != UserPreferenceCategory.General &&
                e.Category != UserPreferenceCategory.Color &&
                e.Category != UserPreferenceCategory.VisualStyle) return;

            theme = Program.DesktopUiTheme.ReadFromSystem();
            ApplyTheme();
        }

        private void ApplyTheme()
        {
            Program.DesktopUiTheme.ApplyToForm(this, theme);
        }

        private static void OpenFolder(string path)
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }

        private static void SafeAction(Action action)
        {
            try { action(); }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "HNL QLTC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private sealed class HomeAction
        {
            internal string Caption { get; private set; }
            internal Action Handler { get; private set; }

            internal HomeAction(string caption, Action handler)
            {
                Caption = caption;
                Handler = handler;
            }
        }
    }

    internal sealed class EmbeddedWebViewRuntime : IDisposable
    {
        private const string CoreResource = "HNL.QLTC.WebView2.Core";
        private const string WinFormsResource = "HNL.QLTC.WebView2.WinForms";
        private const string LoaderX64Resource = "HNL.QLTC.WebView2.Loader.x64";
        private const string LoaderX86Resource = "HNL.QLTC.WebView2.Loader.x86";

        private readonly Panel host;
        private readonly string userDataFolder;
        private readonly string initialUrl;
        private readonly Action<string> statusCallback;
        private readonly Action<string> failureCallback;
        private readonly System.Windows.Forms.Timer coreTimer;
        private Control webView;
        private object coreWebView2;
        private bool eventsAttached;
        private string runtimeDirectory;

        internal bool IsReady { get { return coreWebView2 != null; } }

        internal EmbeddedWebViewRuntime(Panel host, string userDataFolder, string initialUrl, Action<string> statusCallback, Action<string> failureCallback)
        {
            this.host = host;
            this.userDataFolder = userDataFolder;
            this.initialUrl = initialUrl;
            this.statusCallback = statusCallback;
            this.failureCallback = failureCallback;
            coreTimer = new System.Windows.Forms.Timer { Interval = 250 };
            coreTimer.Tick += delegate { PollCore(); };
        }

        internal void Start()
        {
            PrepareEmbeddedSdk();

            Assembly winFormsAssembly = Assembly.LoadFrom(Path.Combine(runtimeDirectory, "Microsoft.Web.WebView2.WinForms.dll"));
            Type webViewType = winFormsAssembly.GetType("Microsoft.Web.WebView2.WinForms.WebView2", true);
            Type creationType = winFormsAssembly.GetType("Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties", true);

            object creation = Activator.CreateInstance(creationType);
            creationType.GetProperty("UserDataFolder").SetValue(creation, userDataFolder, null);

            webView = (Control)Activator.CreateInstance(webViewType);
            webView.Dock = DockStyle.Fill;
            webView.Margin = new Padding(0);
            webView.Tag = "root";
            webViewType.GetProperty("CreationProperties").SetValue(webView, creation, null);

            EventInfo initEvent = webViewType.GetEvent("CoreWebView2InitializationCompleted");
            if (initEvent != null)
            {
                Delegate handler = CreateEventDelegate(initEvent.EventHandlerType, OnInitializationCompleted);
                initEvent.AddEventHandler(webView, handler);
            }

            host.Controls.Add(webView);
            webView.BringToFront();
            webViewType.GetProperty("Source").SetValue(webView, new Uri(initialUrl), null);
            coreTimer.Start();
            statusCallback("Đang mở HNL QLTC bên trong EXE...");
        }

        internal void Navigate(string url)
        {
            if (webView == null) return;
            try
            {
                webView.GetType().GetProperty("Source").SetValue(webView, new Uri(url), null);
            }
            catch (Exception ex)
            {
                failureCallback("Không thể điều hướng WebView2: " + ex.Message);
            }
        }

        internal void Reload()
        {
            InvokeCoreMethod("Reload");
        }

        internal void GoBack()
        {
            if (!GetCoreBool("CanGoBack")) return;
            InvokeCoreMethod("GoBack");
        }

        internal void GoForward()
        {
            if (!GetCoreBool("CanGoForward")) return;
            InvokeCoreMethod("GoForward");
        }

        private void PollCore()
        {
            if (webView == null || eventsAttached) return;
            try
            {
                object core = webView.GetType().GetProperty("CoreWebView2").GetValue(webView, null);
                if (core == null) return;
                AttachCore(core);
            }
            catch { }
        }

        private void OnInitializationCompleted(object sender, object args)
        {
            try
            {
                PropertyInfo successProperty = args.GetType().GetProperty("IsSuccess");
                bool success = successProperty != null && (bool)successProperty.GetValue(args, null);
                if (!success)
                {
                    PropertyInfo exceptionProperty = args.GetType().GetProperty("InitializationException");
                    Exception error = exceptionProperty == null ? null : exceptionProperty.GetValue(args, null) as Exception;
                    failureCallback(error == null ? "WebView2 Runtime chưa sẵn sàng." : error.Message);
                    return;
                }

                object core = webView.GetType().GetProperty("CoreWebView2").GetValue(webView, null);
                if (core != null) AttachCore(core);
            }
            catch (Exception ex)
            {
                failureCallback("Khởi tạo WebView2 không hoàn tất: " + ex.Message);
            }
        }

        private void AttachCore(object core)
        {
            if (eventsAttached || core == null) return;
            coreWebView2 = core;
            eventsAttached = true;
            coreTimer.Stop();

            TrySetSetting(core, "IsStatusBarEnabled", false);
            TrySetSetting(core, "AreBrowserAcceleratorKeysEnabled", true);
            TrySetSetting(core, "AreDefaultContextMenusEnabled", true);
            TrySetSetting(core, "IsZoomControlEnabled", true);

            AddCoreEvent(core, "NewWindowRequested", OnNewWindowRequested);
            AddCoreEvent(core, "NavigationStarting", OnNavigationStarting);
            AddCoreEvent(core, "NavigationCompleted", OnNavigationCompleted);
            AddCoreEvent(core, "DocumentTitleChanged", OnDocumentTitleChanged);

            statusCallback("HNL QLTC đang chạy bên trong ứng dụng Windows • WebView2 sẵn sàng.");
        }

        private void OnNewWindowRequested(object sender, object args)
        {
            try
            {
                string uri = Convert.ToString(args.GetType().GetProperty("Uri").GetValue(args, null));
                PropertyInfo handled = args.GetType().GetProperty("Handled");
                if (handled != null) handled.SetValue(args, true, null);
                if (!string.IsNullOrWhiteSpace(uri)) Navigate(uri);
            }
            catch { }
        }

        private void OnNavigationStarting(object sender, object args)
        {
            try
            {
                string uri = Convert.ToString(args.GetType().GetProperty("Uri").GetValue(args, null));
                if (!string.IsNullOrWhiteSpace(uri) &&
                    !uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                    !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                    !uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase) &&
                    !uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    PropertyInfo cancel = args.GetType().GetProperty("Cancel");
                    if (cancel != null) cancel.SetValue(args, true, null);
                    Process.Start(new ProcessStartInfo { FileName = uri, UseShellExecute = true });
                }
            }
            catch { }
        }

        private void OnNavigationCompleted(object sender, object args)
        {
            try
            {
                PropertyInfo successProperty = args.GetType().GetProperty("IsSuccess");
                bool success = successProperty != null && (bool)successProperty.GetValue(args, null);
                statusCallback(success
                    ? "HNL QLTC đang chạy bên trong ứng dụng Windows."
                    : "Trang chưa tải hoàn tất; kiểm tra kết nối mạng hoặc bấm Tải lại.");
            }
            catch { }
        }

        private void OnDocumentTitleChanged(object sender, object args)
        {
            // Kept intentionally light: the native window title remains the stable HNL QLTC product name.
        }

        private void AddCoreEvent(object core, string eventName, Action<object, object> callback)
        {
            try
            {
                EventInfo evt = core.GetType().GetEvent(eventName);
                if (evt == null) return;
                evt.AddEventHandler(core, CreateEventDelegate(evt.EventHandlerType, callback));
            }
            catch { }
        }

        private static Delegate CreateEventDelegate(Type eventHandlerType, Action<object, object> callback)
        {
            MethodInfo invoke = eventHandlerType.GetMethod("Invoke");
            ParameterInfo[] parameters = invoke.GetParameters();
            var sender = Expression.Parameter(parameters[0].ParameterType, "sender");
            var args = Expression.Parameter(parameters[1].ParameterType, "args");
            MethodInfo callbackInvoke = typeof(Action<object, object>).GetMethod("Invoke");
            var body = Expression.Call(
                Expression.Constant(callback),
                callbackInvoke,
                Expression.Convert(sender, typeof(object)),
                Expression.Convert(args, typeof(object))
            );
            return Expression.Lambda(eventHandlerType, body, sender, args).Compile();
        }

        private static void TrySetSetting(object core, string propertyName, bool value)
        {
            try
            {
                object settings = core.GetType().GetProperty("Settings").GetValue(core, null);
                PropertyInfo property = settings.GetType().GetProperty(propertyName);
                if (property != null && property.CanWrite) property.SetValue(settings, value, null);
            }
            catch { }
        }

        private bool GetCoreBool(string propertyName)
        {
            if (coreWebView2 == null) return false;
            try
            {
                PropertyInfo property = coreWebView2.GetType().GetProperty(propertyName);
                return property != null && (bool)property.GetValue(coreWebView2, null);
            }
            catch { return false; }
        }

        private void InvokeCoreMethod(string methodName)
        {
            if (coreWebView2 == null) return;
            try
            {
                MethodInfo method = coreWebView2.GetType().GetMethod(methodName, Type.EmptyTypes);
                if (method != null) method.Invoke(coreWebView2, null);
            }
            catch { }
        }

        private void PrepareEmbeddedSdk()
        {
            runtimeDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QLTCAnPhu",
                "WebView2Bridge",
                Program.GetReleaseTag()
            );
            Directory.CreateDirectory(runtimeDirectory);

            string corePath = Path.Combine(runtimeDirectory, "Microsoft.Web.WebView2.Core.dll");
            string winFormsPath = Path.Combine(runtimeDirectory, "Microsoft.Web.WebView2.WinForms.dll");
            string loaderPath = Path.Combine(runtimeDirectory, "WebView2Loader.dll");

            ExtractResource(CoreResource, corePath);
            ExtractResource(WinFormsResource, winFormsPath);
            ExtractResource(Environment.Is64BitProcess ? LoaderX64Resource : LoaderX86Resource, loaderPath);

            SetDllDirectory(runtimeDirectory);
            Assembly.LoadFrom(corePath);
        }

        private static void ExtractResource(string resourceName, string targetPath)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream input = assembly.GetManifestResourceStream(resourceName))
            {
                if (input == null) throw new InvalidOperationException("Thiếu thành phần WebView2 nhúng: " + resourceName);

                bool replace = true;
                if (File.Exists(targetPath))
                {
                    try { replace = new FileInfo(targetPath).Length != input.Length; }
                    catch { replace = true; }
                }
                if (!replace) return;

                string tempPath = targetPath + ".new";
                using (FileStream output = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    input.CopyTo(output);
                }
                File.Copy(tempPath, targetPath, true);
                File.Delete(tempPath);
            }
        }

        public void Dispose()
        {
            try { coreTimer.Stop(); } catch { }
            try { coreTimer.Dispose(); } catch { }
            try { if (webView != null) webView.Dispose(); } catch { }
            webView = null;
            coreWebView2 = null;
            eventsAttached = false;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool SetDllDirectory(string lpPathName);
    }
}
