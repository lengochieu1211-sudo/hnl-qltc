using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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

        private readonly TableLayoutPanel rootLayout;
        private readonly Panel toolbarPanel;
        private readonly FlowLayoutPanel navPanel;
        private readonly TableLayoutPanel footerPanel;
        private readonly Panel contentHost;
        private readonly Panel webHost;
        private readonly Panel homeHost;
        private readonly PictureBox brandLogo;
        private readonly Label brandLabel;
        private readonly Label releaseLabel;
        private readonly Label webStatusLabel;
        private readonly Label syncStatusLabel;
        private readonly Button syncButton;
        private readonly Button reloadButton;
        private readonly Button moreButton;
        private readonly Button compactButton;
        private readonly ToolTip chromeToolTip;
        private readonly DesktopLocalStore localStore;
        private readonly NotifyIcon trayIcon;
        private readonly System.Windows.Forms.Timer maintenanceTimer;
        private Panel downloadNoticePanel;
        private Label downloadTitleLabel;
        private Label downloadPathLabel;
        private Button downloadOpenFileButton;
        private Button downloadOpenFolderButton;
        private Button downloadDismissButton;
        private ToolStripMenuItem recentDownloadMenuItem;
        private string lastDownloadedPath;
        private ContextMenuStrip moreMenu;
        private ContextMenuStrip syncMenu;
        private Program.DesktopUiTheme theme;
        private EmbeddedWebViewRuntime embeddedRuntime;
        private bool webInitializationStarted;
        private bool allowClose;
        private bool compactChrome;
        private FormWindowState restoreWindowState = FormWindowState.Normal;
        private int maintenanceRunning;

        private const float NormalHeaderHeight = 38F;
        private const float CompactHeaderHeight = 28F;
        private const float NormalFooterHeight = 0F;

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

            KeyPreview = true;

            rootLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 3,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, NormalHeaderHeight));
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, NormalFooterHeight));
            Controls.Add(rootLayout);

            toolbarPanel = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(8, 3, 8, 3),
                Margin = new Padding(0),
                Tag = "header"
            };
            rootLayout.Controls.Add(toolbarPanel, 0, 0);

            if (Icon != null)
            {
                brandLogo = new PictureBox
                {
                    Size = new Size(28, 28),
                    Location = new Point(10, 9),
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Image = Icon.ToBitmap(),
                    BackColor = Color.Transparent,
                    Visible = false
                };
                toolbarPanel.Controls.Add(brandLogo);
            }

            brandLabel = new Label
            {
                AutoSize = true,
                Text = "HNL QLTC",
                Font = new Font("Segoe UI", 11.5F, FontStyle.Bold),
                Location = new Point(46, 5),
                Tag = "title",
                Visible = false
            };
            toolbarPanel.Controls.Add(brandLabel);

            releaseLabel = new Label
            {
                AutoSize = true,
                Text = Program.GetReleaseTag(),
                Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                Location = new Point(47, 25),
                Tag = "subtle",
                Visible = false
            };
            toolbarPanel.Controls.Add(releaseLabel);

            navPanel = new FlowLayoutPanel
            {
                AutoSize = false,
                Height = 34,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Location = new Point(8, 3),
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "header"
            };
            // Width/right position are managed explicitly so WinForms DPI scaling cannot
            // apply a second right-anchor adjustment and clip the native action group.
            navPanel.Anchor = AnchorStyles.Top;
            toolbarPanel.Controls.Add(navPanel);
            toolbarPanel.Resize += delegate { PositionToolbarActions(); };

            syncButton = MakeToolbarPrimaryButton("Đồng bộ", 108);
            syncButton.Height = 30;
            syncButton.Margin = new Padding(0, 1, 5, 1);
            syncButton.Padding = new Padding(9, 0, 9, 0);
            SetToolbarGlyph(syncButton, ToolbarGlyph.SyncOk);
            syncButton.AccessibleName = "Trạng thái đồng bộ";
            syncButton.Click += delegate { ShowSyncMenu(); };
            navPanel.Controls.Add(syncButton);

            reloadButton = MakeToolbarButton(string.Empty, 30);
            reloadButton.Height = 30;
            reloadButton.Margin = new Padding(0, 1, 1, 1);
            reloadButton.Padding = new Padding(0);
            reloadButton.Tag = "toolbar-icon";
            SetToolbarGlyph(reloadButton, ToolbarGlyph.Reload);
            reloadButton.AccessibleName = "Tải lại HNL QLTC";
            reloadButton.Click += delegate
            {
                ShowWebApp();
                if (embeddedRuntime != null) embeddedRuntime.Reload();
            };
            navPanel.Controls.Add(reloadButton);

            moreButton = MakeToolbarButton(string.Empty, 30);
            moreButton.Height = 30;
            moreButton.Margin = new Padding(0, 1, 1, 1);
            moreButton.Padding = new Padding(0);
            moreButton.Tag = "toolbar-icon";
            SetToolbarGlyph(moreButton, ToolbarGlyph.More);
            moreButton.AccessibleName = "Tùy chọn khác";
            navPanel.Controls.Add(moreButton);

            compactButton = MakeToolbarButton(string.Empty, 30);
            compactButton.Height = 30;
            compactButton.Margin = new Padding(0, 1, 0, 1);
            compactButton.Padding = new Padding(0);
            compactButton.Tag = "toolbar-icon";
            SetToolbarGlyph(compactButton, ToolbarGlyph.Collapse);
            compactButton.AccessibleName = "Thu gọn thanh ứng dụng";
            compactButton.Click += delegate { SetCompactChrome(!compactChrome); };
            navPanel.Controls.Add(compactButton);

            chromeToolTip = new ToolTip
            {
                AutoPopDelay = 6000,
                InitialDelay = 400,
                ReshowDelay = 150,
                ShowAlways = true
            };
            chromeToolTip.SetToolTip(syncButton, "Xem trạng thái đồng bộ");
            chromeToolTip.SetToolTip(reloadButton, "Tải lại HNL QLTC");
            chromeToolTip.SetToolTip(moreButton, "Công cụ và tùy chọn khác");
            chromeToolTip.SetToolTip(compactButton, "Thu gọn thanh trên và ẩn thanh trạng thái dưới");

            moreMenu = BuildMoreMenu();
            syncMenu = BuildSyncMenu();
            moreButton.Click += delegate { ShowMoreMenu(moreButton); };
            PositionToolbarActions();

            contentHost = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "root"
            };
            rootLayout.Controls.Add(contentHost, 0, 1);

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

            // Download feedback must never sit inside the WebView/content layer because it
            // can cover report dialogs and mobile-style modals. RC2.2.26.10 surfaces
            // completion through the Windows notification area and the persistent
            // "... > File vừa tải" menu instead of mounting an in-content overlay.

            footerPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(14, 0, 14, 0),
                Margin = new Padding(0),
                Tag = "root"
            };
            footerPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55F));
            footerPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45F));
            rootLayout.Controls.Add(footerPanel, 0, 2);

            webStatusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Text = "Đang chuẩn bị HNL QLTC...",
                Tag = "muted"
            };
            footerPanel.Controls.Add(webStatusLabel, 0, 0);

            syncStatusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleRight,
                Text = "Đồng bộ: đang kiểm tra",
                Tag = "muted"
            };
            footerPanel.Controls.Add(syncStatusLabel, 1, 0);
            footerPanel.Visible = false;

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
            trayMenu.Items.Add("Công cụ máy tính", null, delegate { RestoreFromTray(); ShowHome(); });
            trayMenu.Items.Add("Trung tâm đồng bộ", null, delegate { RestoreFromTray(); OpenSyncCenter(); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Thoát", null, delegate { allowClose = true; Close(); });
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.DoubleClick += delegate { RestoreFromTray(); ShowWebApp(); };

            maintenanceTimer = new System.Windows.Forms.Timer { Interval = 30000 };
            maintenanceTimer.Tick += delegate { RunBackgroundMaintenance(); };
            maintenanceTimer.Start();

            KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.F11)
                {
                    SetCompactChrome(!compactChrome);
                    e.Handled = true;
                    e.SuppressKeyPress = true;
                }
            };

            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    Hide();
                    trayIcon.ShowBalloonTip(1200, "HNL QLTC", "Ứng dụng vẫn đang chạy ở khay hệ thống.", ToolTipIcon.Info);
                }
                else
                {
                    restoreWindowState = WindowState;
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
                if (syncMenu != null) syncMenu.Dispose();
                if (moreMenu != null) moreMenu.Dispose();
                chromeToolTip.Dispose();
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
            SetNavigationState(true);
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
                            if (message.IndexOf("WebView2 sẵn sàng", StringComparison.OrdinalIgnoreCase) >= 0)
                                WriteWebViewSmokeMarker("READY|" + Program.GetReleaseTag());
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
                        WriteWebViewSmokeMarker("FAIL|" + error);
                        try
                        {
                            if (IsDisposed) return;
                            BeginInvoke((MethodInvoker)delegate { ShowWebViewFailure(error); });
                        }
                        catch { }
                    },
                    delegate(string state, string path, string detail)
                    {
                        ShowDownloadNotice(state, path, detail);
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
                Padding = new Padding(32),
                Tag = "root"
            };

            var heading = new Label
            {
                AutoSize = true,
                Text = "Công cụ máy tính",
                Font = new Font("Segoe UI", 20F, FontStyle.Bold),
                Location = new Point(32, 28),
                Tag = "title"
            };
            panel.Controls.Add(heading);

            var sub = new Label
            {
                AutoSize = true,
                Text = "Chỉ mở khi cần. HNL QLTC vẫn là màn hình làm việc chính.",
                Location = new Point(35, 68),
                Tag = "muted"
            };
            panel.Controls.Add(sub);

            var grid = new TableLayoutPanel
            {
                Location = new Point(32, 112),
                Size = new Size(1050, 250),
                ColumnCount = 2,
                RowCount = 1,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
                Tag = "root"
            };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            panel.Controls.Add(grid);

            panel.Resize += delegate
            {
                grid.Size = new Size(Math.Max(620, panel.ClientSize.Width - 64), 250);
            };

            grid.Controls.Add(BuildHomeCard("Dữ liệu HNL trên máy", "Các thư mục người dùng thường cần xem. Công cụ kỹ thuật được ẩn khỏi màn hình này.", new[]
            {
                new HomeAction("Mở Backup", delegate { OpenFolder(Program.DesktopPaths.Backup); }),
                new HomeAction("File đã xuất", delegate { OpenFolder(Program.DesktopPaths.Exports); }),
                new HomeAction("Ảnh local", delegate { OpenFolder(Program.DesktopPaths.Photos); })
            }), 0, 0);

            grid.Controls.Add(BuildHomeCard("Đồng bộ", "Theo dõi dữ liệu local chờ xử lý. Khi mọi thứ bình thường, bạn không cần mở phần chi tiết.", new[]
            {
                new HomeAction("Trung tâm đồng bộ", delegate { OpenSyncCenter(); }),
                new HomeAction("Đồng bộ ngay", delegate { ShowWebApp(); RefreshLocalIndex(false); })
            }), 1, 0);

            var back = MakeToolbarPrimaryButton("← Quay lại HNL QLTC", 180);
            back.Location = new Point(32, 392);
            back.Click += delegate { ShowWebApp(); };
            panel.Controls.Add(back);

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

            var computer = new ToolStripMenuItem("Công cụ máy tính");
            computer.DropDownItems.Add("Mở Backup", null, delegate { OpenFolder(Program.DesktopPaths.Backup); });
            computer.DropDownItems.Add("File đã xuất", null, delegate { OpenFolder(Program.DesktopPaths.Exports); });
            recentDownloadMenuItem = new ToolStripMenuItem("File vừa tải: chưa có") { Enabled = false };
            recentDownloadMenuItem.Click += delegate { OpenLastDownloadLocation(); };
            computer.DropDownItems.Add(recentDownloadMenuItem);
            computer.DropDownItems.Add("Ảnh local", null, delegate { OpenFolder(Program.DesktopPaths.Photos); });
            computer.DropDownItems.Add(new ToolStripSeparator());
            computer.DropDownItems.Add("Mở màn hình công cụ", null, delegate { ShowHome(); });
            menu.Items.Add(computer);

            var sync = new ToolStripMenuItem("Đồng bộ nâng cao");
            sync.DropDownItems.Add("Trung tâm đồng bộ", null, delegate { OpenSyncCenter(); });
            sync.DropDownItems.Add("Quét lại dữ liệu HNL trên máy", null, delegate { RefreshLocalIndex(true); });
            menu.Items.Add(sync);

            var support = new ToolStripMenuItem("Hỗ trợ & kỹ thuật");
            support.DropDownItems.Add("Chẩn đoán", null, delegate { OpenFolder(Program.DesktopPaths.Diagnostics); });
            support.DropDownItems.Add("Logs", null, delegate { OpenFolder(Program.DesktopPaths.Logs); });
            support.DropDownItems.Add("DesktopBridge", null, delegate { OpenFolder(Program.DesktopPaths.DesktopBridge); });
            support.DropDownItems.Add(new ToolStripSeparator());
            support.DropDownItems.Add("Mở bằng trình duyệt", null, delegate { Program.OpenHnlQltcExternal(); });
            menu.Items.Add(support);

            var versionInfo = new ToolStripMenuItem("HNL QLTC • " + Program.GetReleaseTag()) { Enabled = false };
            menu.Items.Add(versionInfo);

            var appearance = new ToolStripMenuItem("Giao diện");
            appearance.DropDownItems.Add("Chế độ gọn (F11)", null, delegate { SetCompactChrome(!compactChrome); });
            menu.Items.Add(appearance);

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Thoát HNL QLTC", null, delegate { allowClose = true; Close(); });
            UpdateRecentDownloadMenu();
            return menu;
        }


        private void BuildDownloadNotice()
        {
            downloadNoticePanel = new Panel
            {
                Visible = false,
                Size = new Size(560, 96),
                Padding = new Padding(12, 9, 12, 9),
                Margin = new Padding(0),
                BorderStyle = BorderStyle.FixedSingle,
                Tag = "card"
            };

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 3,
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "card"
            };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24F));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            downloadNoticePanel.Controls.Add(layout);

            downloadTitleLabel = new Label
            {
                Dock = DockStyle.Fill,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Font = new Font("Segoe UI", 9.25F, FontStyle.Bold),
                Text = "Đang tải file...",
                Tag = "title"
            };
            layout.Controls.Add(downloadTitleLabel, 0, 0);

            downloadPathLabel = new Label
            {
                Dock = DockStyle.Fill,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Text = string.Empty,
                Tag = "subtle"
            };
            layout.Controls.Add(downloadPathLabel, 0, 1);

            var actions = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Padding = new Padding(0, 2, 0, 0),
                Margin = new Padding(0),
                Tag = "card"
            };
            layout.Controls.Add(actions, 0, 2);

            downloadDismissButton = MakeToolbarButton("Đóng", 0);
            downloadDismissButton.AutoSize = true;
            downloadDismissButton.Height = 28;
            downloadDismissButton.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            downloadDismissButton.Click += delegate { downloadNoticePanel.Visible = false; };
            actions.Controls.Add(downloadDismissButton);

            downloadOpenFolderButton = MakeToolbarButton("Mở thư mục", 0);
            downloadOpenFolderButton.AutoSize = true;
            downloadOpenFolderButton.Height = 28;
            downloadOpenFolderButton.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            downloadOpenFolderButton.Click += delegate { OpenLastDownloadLocation(); };
            actions.Controls.Add(downloadOpenFolderButton);

            downloadOpenFileButton = MakeToolbarPrimaryButton("Mở file", 0);
            downloadOpenFileButton.AutoSize = true;
            downloadOpenFileButton.Height = 28;
            downloadOpenFileButton.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            downloadOpenFileButton.Click += delegate { OpenLastDownloadedFile(); };
            actions.Controls.Add(downloadOpenFileButton);

            contentHost.Controls.Add(downloadNoticePanel);
            PositionDownloadNotice();
        }

        private void PositionDownloadNotice()
        {
            if (downloadNoticePanel == null || contentHost == null) return;
            int margin = 14;
            int availableWidth = Math.Max(320, contentHost.ClientSize.Width - margin * 2);
            downloadNoticePanel.Width = Math.Min(560, availableWidth);
            downloadNoticePanel.Location = new Point(
                Math.Max(margin, contentHost.ClientSize.Width - downloadNoticePanel.Width - margin),
                Math.Max(margin, contentHost.ClientSize.Height - downloadNoticePanel.Height - margin)
            );
        }

        private void ShowDownloadNotice(string state, string path, string detail)
        {
            if (InvokeRequired)
            {
                try { BeginInvoke((MethodInvoker)delegate { ShowDownloadNotice(state, path, detail); }); } catch { }
                return;
            }
            if (IsDisposed || Disposing) return;

            // Defensive: older sessions/builds used an in-content native panel. Never let
            // that surface cover the embedded web UI again.
            if (downloadNoticePanel != null) downloadNoticePanel.Visible = false;

            string fileName = string.IsNullOrWhiteSpace(path) ? "file" : Path.GetFileName(path);
            bool completed = string.Equals(state, "completed", StringComparison.OrdinalIgnoreCase);
            bool failed = string.Equals(state, "failed", StringComparison.OrdinalIgnoreCase);

            if (completed && !string.IsNullOrWhiteSpace(path))
            {
                lastDownloadedPath = path;
                UpdateRecentDownloadMenu();
                chromeToolTip.SetToolTip(
                    moreButton,
                    "File vừa tải: " + fileName + "\n" + path + "\nMở menu ... để mở file hoặc thư mục."
                );

                try
                {
                    trayIcon.ShowBalloonTip(
                        5000,
                        "HNL QLTC • Đã tải xong",
                        fileName + "\nLưu tại: " + path + "\nMở menu ... > File vừa tải để xem lại.",
                        ToolTipIcon.Info
                    );
                }
                catch { }
                return;
            }

            if (failed)
            {
                string message = fileName +
                    (string.IsNullOrWhiteSpace(detail) ? string.Empty : "\n" + detail);
                try
                {
                    trayIcon.ShowBalloonTip(
                        5000,
                        "HNL QLTC • Tải file chưa hoàn tất",
                        message,
                        ToolTipIcon.Warning
                    );
                }
                catch { }
            }
        }

        private void UpdateRecentDownloadMenu()
        {
            if (recentDownloadMenuItem == null || recentDownloadMenuItem.IsDisposed) return;

            recentDownloadMenuItem.DropDownItems.Clear();
            if (string.IsNullOrWhiteSpace(lastDownloadedPath))
            {
                recentDownloadMenuItem.Text = "File vừa tải: chưa có";
                recentDownloadMenuItem.ToolTipText = string.Empty;
                recentDownloadMenuItem.Enabled = false;
                return;
            }

            string fileName = Path.GetFileName(lastDownloadedPath);
            string folder = Path.GetDirectoryName(lastDownloadedPath);
            if (string.IsNullOrWhiteSpace(folder)) folder = Program.DesktopPaths.Exports;

            recentDownloadMenuItem.Text = "File vừa tải: " + fileName;
            recentDownloadMenuItem.ToolTipText = lastDownloadedPath;
            recentDownloadMenuItem.Enabled = true;

            var locationItem = new ToolStripMenuItem("Lưu tại: " + folder)
            {
                Enabled = false,
                ToolTipText = lastDownloadedPath
            };
            recentDownloadMenuItem.DropDownItems.Add(locationItem);
            recentDownloadMenuItem.DropDownItems.Add(new ToolStripSeparator());
            recentDownloadMenuItem.DropDownItems.Add("Mở file", null, delegate { OpenLastDownloadedFile(); });
            recentDownloadMenuItem.DropDownItems.Add("Mở thư mục", null, delegate { OpenLastDownloadLocation(); });
        }

        private void OpenLastDownloadedFile()
        {
            if (string.IsNullOrWhiteSpace(lastDownloadedPath) || !File.Exists(lastDownloadedPath))
            {
                MessageBox.Show("Không tìm thấy file vừa tải.", "HNL QLTC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Process.Start(new ProcessStartInfo { FileName = lastDownloadedPath, UseShellExecute = true });
        }

        private void OpenLastDownloadLocation()
        {
            if (string.IsNullOrWhiteSpace(lastDownloadedPath))
            {
                OpenFolder(Program.DesktopPaths.Exports);
                return;
            }

            string folder = Path.GetDirectoryName(lastDownloadedPath);
            if (string.IsNullOrWhiteSpace(folder)) folder = Program.DesktopPaths.Exports;
            Directory.CreateDirectory(folder);
            if (File.Exists(lastDownloadedPath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = "/select,\"" + lastDownloadedPath + "\"",
                    UseShellExecute = true
                });
            }
            else
            {
                OpenFolder(folder);
            }
        }

        private void ShowMoreMenu(Control owner)
        {
            if (owner == null || owner.IsDisposed || IsDisposed || Disposing) return;

            if (moreMenu == null || moreMenu.IsDisposed)
            {
                moreMenu = BuildMoreMenu();
            }

            try
            {
                moreMenu.Show(owner, new Point(0, owner.Height + 2));
            }
            catch (ObjectDisposedException)
            {
                if (IsDisposed || Disposing) return;
                moreMenu = BuildMoreMenu();
                moreMenu.Show(owner, new Point(0, owner.Height + 2));
            }
        }

        private Button MakeToolbarButton(string text, int width)
        {
            var button = new RoundedToolbarButton
            {
                Text = text,
                Height = 32,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Margin = new Padding(2, 1, 2, 1),
                Padding = new Padding(8, 0, 8, 0),
                Tag = "secondary",
                TabStop = true
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

        private static void SetToolbarGlyph(Button button, ToolbarGlyph glyph)
        {
            RoundedToolbarButton rounded = button as RoundedToolbarButton;
            if (rounded != null) rounded.Glyph = glyph;
        }

        private void ShowHome()
        {
            homeHost.BringToFront();
            SetNavigationState(false);
            webStatusLabel.Text = "Trung tâm Windows • HNL QLTC Web vẫn được giữ sẵn ở nền.";
        }

        private void SetNavigationState(bool webActive)
        {
            // The web app is the primary destination. Native tools stay behind the More menu.
            ApplyTheme();
        }

        private int CalculateToolbarActionsWidth()
        {
            if (navPanel == null) return 0;
            int width = navPanel.Padding.Horizontal;
            foreach (Control control in navPanel.Controls)
            {
                if (!control.Visible) continue;
                width += control.Width + control.Margin.Horizontal;
            }
            return Math.Max(1, width);
        }

        private void PositionToolbarActions()
        {
            if (toolbarPanel == null || navPanel == null) return;

            int right = compactChrome ? 8 : 10;
            int preferred = CalculateToolbarActionsWidth();
            navPanel.Width = preferred;
            navPanel.Height = compactChrome ? 26 : 32;

            int x = Math.Max(8, toolbarPanel.ClientSize.Width - preferred - right);
            navPanel.Location = new Point(x, compactChrome ? 2 : 4);
            navPanel.BringToFront();
        }

        private void SetCompactChrome(bool compact)
        {
            compactChrome = compact;
            rootLayout.SuspendLayout();
            toolbarPanel.SuspendLayout();
            navPanel.SuspendLayout();
            try
            {
                rootLayout.RowStyles[0].Height = compact ? CompactHeaderHeight : NormalHeaderHeight;
                rootLayout.RowStyles[2].Height = 0F;
                footerPanel.Visible = false;

                // Windows already shows HNL QLTC in the native title bar and the embedded
                // web app owns its project/app identity. Repeating logo/title/version in
                // this thin command strip creates a distracting third branding layer.
                // RC2.2.26.9 keeps this native strip action-only on every Windows build.
                if (brandLogo != null) brandLogo.Visible = false;
                brandLabel.Visible = false;
                releaseLabel.Visible = false;

                // Collapsed mode is intentionally a real collapse: keep only a small
                // expand affordance. The previous implementation merely shaved a few
                // pixels from the row, which looked unchanged on high-DPI displays.
                syncButton.Visible = !compact;
                reloadButton.Visible = !compact;
                moreButton.Visible = !compact;
                compactButton.Visible = true;

                navPanel.Height = compact ? 24 : 32;
                compactButton.Size = compact ? new Size(28, 24) : new Size(30, 30);
                compactButton.Margin = compact ? new Padding(0, 1, 0, 1) : new Padding(0, 1, 0, 1);
                syncButton.Height = 30;
                reloadButton.Height = 30;
                moreButton.Height = 30;

                SetToolbarGlyph(compactButton, compact ? ToolbarGlyph.Expand : ToolbarGlyph.Collapse);
                compactButton.AccessibleName = compact ? "Mở rộng thanh ứng dụng" : "Thu gọn thanh ứng dụng";
                chromeToolTip.SetToolTip(compactButton, compact
                    ? "Mở rộng thanh ứng dụng"
                    : "Thu gọn thanh ứng dụng");

                navPanel.PerformLayout();
                PositionToolbarActions();
                toolbarPanel.Invalidate();
            }
            finally
            {
                navPanel.ResumeLayout(true);
                toolbarPanel.ResumeLayout(true);
                rootLayout.ResumeLayout(true);
            }
        }

        private ContextMenuStrip BuildSyncMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("Đang kiểm tra đồng bộ...") { Enabled = false });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Đồng bộ ngay", null, delegate
            {
                RefreshLocalIndex(false);
                ShowWebApp();
                RefreshSyncStatus();
            });
            menu.Items.Add("Xem chi tiết", null, delegate { OpenSyncCenter(); });
            menu.Opening += delegate { RefreshSyncMenuStatus(menu); };
            return menu;
        }

        private void RefreshSyncMenuStatus(ContextMenuStrip menu)
        {
            if (menu == null || menu.IsDisposed || menu.Items.Count == 0) return;

            int pending = 0;
            int ready = 0;
            if (localStore != null && localStore.IsReady)
            {
                pending = localStore.CountQueuePending();
                ready = localStore.CountQueueReady();
            }

            int waiting = pending + ready;
            menu.Items[0].Text = waiting == 0
                ? "✓ Tất cả đã đồng bộ"
                : "⚠ Còn " + waiting + " mục đang chờ";
        }

        private void ShowSyncMenu()
        {
            if (syncButton == null || syncButton.IsDisposed || IsDisposed || Disposing) return;

            if (syncMenu == null || syncMenu.IsDisposed)
            {
                syncMenu = BuildSyncMenu();
            }

            RefreshSyncMenuStatus(syncMenu);
            try
            {
                syncMenu.Show(syncButton, new Point(0, syncButton.Height + 2));
            }
            catch (ObjectDisposedException)
            {
                if (IsDisposed || Disposing) return;
                syncMenu = BuildSyncMenu();
                RefreshSyncMenuStatus(syncMenu);
                syncMenu.Show(syncButton, new Point(0, syncButton.Height + 2));
            }
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
                if (syncButton != null)
                {
                    syncButton.Text = "Đồng bộ";
                    SetToolbarGlyph(syncButton, ToolbarGlyph.SyncWarning);
                    syncButton.Tag = "warning";
                }
                return;
            }

            int pending = localStore.CountQueuePending();
            int ready = localStore.CountQueueReady();
            int waiting = pending + ready;
            syncStatusLabel.Text = waiting == 0
                ? "Dữ liệu cục bộ: Bình thường • Đồng bộ: Đã hoàn tất"
                : "Dữ liệu cục bộ: Bình thường • Đồng bộ: Còn " + waiting + " mục";
            if (syncButton != null)
            {
                syncButton.Text = waiting == 0 ? "Đồng bộ" : waiting + " chờ";
                SetToolbarGlyph(syncButton, waiting == 0 ? ToolbarGlyph.SyncOk : ToolbarGlyph.SyncWarning);
                syncButton.Tag = waiting == 0 ? "success" : "warning";
                chromeToolTip.SetToolTip(syncButton, waiting == 0
                    ? "Tất cả dữ liệu local đã xử lý xong"
                    : "Còn " + waiting + " mục đang chờ đồng bộ");
            }
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
            WindowState = restoreWindowState == FormWindowState.Minimized
                ? FormWindowState.Normal
                : restoreWindowState;
            Activate();
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category != UserPreferenceCategory.General &&
                e.Category != UserPreferenceCategory.Color &&
                e.Category != UserPreferenceCategory.VisualStyle) return;

            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke((MethodInvoker)RefreshSystemTheme); } catch { }
                return;
            }
            RefreshSystemTheme();
        }

        private void RefreshSystemTheme()
        {
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
        private static void WriteWebViewSmokeMarker(string value)
        {
            try
            {
                string marker = Environment.GetEnvironmentVariable("HNL_QLTC_WEBVIEW2_SMOKE_FILE");
                if (string.IsNullOrWhiteSpace(marker)) return;
                string directory = Path.GetDirectoryName(marker);
                if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(marker, value + "|PID=" + Process.GetCurrentProcess().Id);
            }
            catch { }
        }


        private enum ToolbarGlyph
        {
            None,
            SyncOk,
            SyncWarning,
            Reload,
            More,
            Collapse,
            Expand
        }

        private sealed class RoundedToolbarButton : Button
        {
            private bool hover;
            private bool pressed;
            private ToolbarGlyph glyph;
            private const int Radius = 7;

            internal ToolbarGlyph Glyph
            {
                get { return glyph; }
                set
                {
                    if (glyph == value) return;
                    glyph = value;
                    Invalidate();
                }
            }

            internal RoundedToolbarButton()
            {
                SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
                FlatStyle = FlatStyle.Flat;
                FlatAppearance.BorderSize = 0;
                UseVisualStyleBackColor = false;
            }

            protected override void OnMouseEnter(EventArgs e)
            {
                hover = true;
                Invalidate();
                base.OnMouseEnter(e);
            }

            protected override void OnMouseLeave(EventArgs e)
            {
                hover = false;
                pressed = false;
                Invalidate();
                base.OnMouseLeave(e);
            }

            protected override void OnMouseDown(MouseEventArgs mevent)
            {
                pressed = true;
                Invalidate();
                base.OnMouseDown(mevent);
            }

            protected override void OnMouseUp(MouseEventArgs mevent)
            {
                pressed = false;
                Invalidate();
                base.OnMouseUp(mevent);
            }

            protected override void OnPaint(PaintEventArgs pevent)
            {
                // Always paint the parent surface first. Owner-drawn rounded controls leave
                // pixels outside the rounded path untouched otherwise; on some Windows DPI /
                // compositor combinations those four corner pixels can show up black.
                Color parentBack = Parent != null ? Parent.BackColor : SystemColors.Control;
                pevent.Graphics.Clear(parentBack);
                pevent.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                pevent.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                Rectangle rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
                Color fill = pressed && FlatAppearance.MouseDownBackColor != Color.Empty
                    ? FlatAppearance.MouseDownBackColor
                    : hover && FlatAppearance.MouseOverBackColor != Color.Empty
                        ? FlatAppearance.MouseOverBackColor
                        : BackColor;

                bool toolbarIcon = string.Equals(Tag as string, "toolbar-icon", StringComparison.Ordinal);
                Color border = toolbarIcon
                    ? fill
                    : (FlatAppearance.BorderColor == Color.Empty ? fill : FlatAppearance.BorderColor);

                using (GraphicsPath path = CreateRoundedPath(rect, Radius))
                using (var brush = new SolidBrush(fill))
                {
                    pevent.Graphics.FillPath(brush, path);
                    // Icon-only utility buttons are intentionally borderless at rest.
                    // Drawing even a same-color anti-aliased outline can darken corner
                    // pixels on some Windows renderers.
                    if (!toolbarIcon)
                    {
                        using (var pen = new Pen(border))
                        {
                            pevent.Graphics.DrawPath(pen, path);
                        }
                    }
                }

                bool hasText = !string.IsNullOrWhiteSpace(Text);
                bool hasGlyph = glyph != ToolbarGlyph.None;
                int iconSize = string.Equals(Tag as string, "toolbar-icon", StringComparison.Ordinal)
                    ? 14
                    : Math.Min(15, Math.Max(12, Height - 14));
                Rectangle iconRect = Rectangle.Empty;
                Rectangle textRect;

                if (hasGlyph && hasText)
                {
                    int iconLeft = Math.Max(8, Padding.Left);
                    iconRect = new Rectangle(iconLeft, (Height - iconSize) / 2, iconSize, iconSize);
                    int textLeft = iconRect.Right + 6;
                    textRect = new Rectangle(textLeft, 0, Math.Max(1, Width - textLeft - Padding.Right), Height);
                }
                else
                {
                    if (hasGlyph)
                    {
                        iconRect = new Rectangle((Width - iconSize) / 2, (Height - iconSize) / 2, iconSize, iconSize);
                    }
                    textRect = new Rectangle(Padding.Left, 0, Math.Max(1, Width - Padding.Horizontal), Height);
                }

                if (hasGlyph) DrawToolbarGlyph(pevent.Graphics, glyph, iconRect, ForeColor);

                if (hasText)
                {
                    TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine;
                    flags |= hasGlyph ? TextFormatFlags.Left : TextFormatFlags.HorizontalCenter;
                    TextRenderer.DrawText(pevent.Graphics, Text, Font, textRect, ForeColor, flags);
                }

                if (Focused && ShowFocusCues)
                {
                    Rectangle focus = Rectangle.Inflate(rect, -4, -4);
                    ControlPaint.DrawFocusRectangle(pevent.Graphics, focus, ForeColor, fill);
                }
            }

            private static void DrawToolbarGlyph(Graphics graphics, ToolbarGlyph glyph, Rectangle r, Color color)
            {
                if (r.Width <= 0 || r.Height <= 0) return;
                int left = r.Left;
                int top = r.Top;
                int right = r.Right - 1;
                int bottom = r.Bottom - 1;
                int cx = left + r.Width / 2;
                int cy = top + r.Height / 2;

                using (var pen = new Pen(color, 1.8F))
                using (var brush = new SolidBrush(color))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    pen.LineJoin = LineJoin.Round;

                    switch (glyph)
                    {
                        case ToolbarGlyph.SyncOk:
                            graphics.DrawLines(pen, new[]
                            {
                                new Point(left + 2, cy),
                                new Point(left + r.Width / 2 - 1, bottom - 2),
                                new Point(right - 1, top + 2)
                            });
                            break;

                        case ToolbarGlyph.SyncWarning:
                            graphics.DrawPolygon(pen, new[]
                            {
                                new Point(cx, top + 1),
                                new Point(right - 1, bottom - 1),
                                new Point(left + 1, bottom - 1)
                            });
                            graphics.DrawLine(pen, cx, top + 5, cx, cy + 2);
                            graphics.FillEllipse(brush, cx - 1, bottom - 4, 2, 2);
                            break;

                        case ToolbarGlyph.Reload:
                            graphics.DrawArc(pen, left + 2, top + 2, Math.Max(7, r.Width - 5), Math.Max(7, r.Height - 5), 40F, 280F);
                            graphics.DrawLines(pen, new[]
                            {
                                new Point(right - 1, top + 2),
                                new Point(right - 5, top + 2),
                                new Point(right - 2, top + 6)
                            });
                            break;

                        case ToolbarGlyph.More:
                            float dot = Math.Max(2F, r.Width / 6F);
                            float gap = r.Width / 4F;
                            for (int i = -1; i <= 1; i++)
                            {
                                graphics.FillEllipse(brush, cx + i * gap - dot / 2F, cy - dot / 2F, dot, dot);
                            }
                            break;

                        case ToolbarGlyph.Collapse:
                            graphics.DrawLines(pen, new[]
                            {
                                new Point(left + 3, cy + 2),
                                new Point(cx, cy - 2),
                                new Point(right - 3, cy + 2)
                            });
                            break;

                        case ToolbarGlyph.Expand:
                            graphics.DrawLines(pen, new[]
                            {
                                new Point(left + 3, cy - 2),
                                new Point(cx, cy + 2),
                                new Point(right - 3, cy - 2)
                            });
                            break;
                    }
                }
            }

            private static GraphicsPath CreateRoundedPath(Rectangle rect, int radius)
            {
                int diameter = Math.Max(2, radius * 2);
                var path = new GraphicsPath();
                path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
                path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
                path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
                path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
                path.CloseFigure();
                return path;
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
        private readonly Action<string, string, string> downloadStatusCallback;
        private readonly System.Windows.Forms.Timer coreTimer;
        private Control webView;
        private object coreWebView2;
        private bool eventsAttached;
        private bool runtimeProbeStarted;
        private string runtimeDirectory;
        private Type webViewType;

        internal bool IsReady { get { return coreWebView2 != null; } }

        internal EmbeddedWebViewRuntime(Panel host, string userDataFolder, string initialUrl, Action<string> statusCallback, Action<string> failureCallback, Action<string, string, string> downloadStatusCallback)
        {
            this.host = host;
            this.userDataFolder = userDataFolder;
            this.initialUrl = initialUrl;
            this.statusCallback = statusCallback;
            this.failureCallback = failureCallback;
            this.downloadStatusCallback = downloadStatusCallback;
            coreTimer = new System.Windows.Forms.Timer { Interval = 250 };
            coreTimer.Tick += delegate { PollCore(); };
        }

        internal void Start()
        {
            PrepareEmbeddedSdk();

            Assembly winFormsAssembly = Assembly.LoadFrom(Path.Combine(runtimeDirectory, "Microsoft.Web.WebView2.WinForms.dll"));
            webViewType = winFormsAssembly.GetType("Microsoft.Web.WebView2.WinForms.WebView2", true);
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
                AttachPrimaryCore(core);
            }
            catch { }
        }

        private void OnInitializationCompleted(object sender, object args)
        {
            try
            {
                if (!ReadInitializationSuccess(args))
                {
                    failureCallback(ReadInitializationError(args, "WebView2 Runtime chưa sẵn sàng."));
                    return;
                }

                object core = webView.GetType().GetProperty("CoreWebView2").GetValue(webView, null);
                if (core != null) AttachPrimaryCore(core);
            }
            catch (Exception ex)
            {
                failureCallback("Khởi tạo WebView2 không hoàn tất: " + ex.Message);
            }
        }

        private void AttachPrimaryCore(object core)
        {
            if (eventsAttached || core == null) return;
            coreWebView2 = core;
            eventsAttached = true;
            coreTimer.Stop();
            ConfigureCore(core, null, true);
            statusCallback("HNL QLTC đang chạy bên trong ứng dụng Windows • WebView2 sẵn sàng.");
        }

        private void ConfigureCore(object core, Form popupOwner, bool primary)
        {
            TrySetSetting(core, "IsStatusBarEnabled", false);
            TrySetSetting(core, "AreBrowserAcceleratorKeysEnabled", true);
            TrySetSetting(core, "AreDefaultContextMenusEnabled", true);
            TrySetSetting(core, "IsZoomControlEnabled", true);

            AddCoreEvent(core, "NewWindowRequested", OnNewWindowRequested);
            AddCoreEvent(core, "NavigationStarting", OnNavigationStarting);
            AddCoreEvent(core, "DownloadStarting", OnDownloadStarting);
            AddCoreEvent(core, "PermissionRequested", OnPermissionRequested);

            if (primary)
            {
                AddCoreEvent(core, "NavigationCompleted", OnNavigationCompleted);
                AddCoreEvent(core, "DocumentTitleChanged", OnDocumentTitleChanged);
            }
            else if (popupOwner != null)
            {
                AddCoreEvent(core, "WindowCloseRequested", delegate
                {
                    SafeClosePopup(popupOwner);
                });
                AddCoreEvent(core, "DocumentTitleChanged", delegate(object sender, object args)
                {
                    try
                    {
                        PropertyInfo titleProperty = sender.GetType().GetProperty("DocumentTitle");
                        string title = titleProperty == null ? null : Convert.ToString(titleProperty.GetValue(sender, null));
                        if (string.IsNullOrWhiteSpace(title)) return;
                        if (popupOwner.IsDisposed) return;
                        popupOwner.BeginInvoke((MethodInvoker)delegate { popupOwner.Text = "HNL QLTC • " + title; });
                    }
                    catch { }
                });
            }
        }

        private void OnNewWindowRequested(object sender, object args)
        {
            PropertyInfo handledProperty = null;
            object deferral = null;
            Form popup = null;
            try
            {
                string uri = ReadStringProperty(args, "Uri");
                handledProperty = args.GetType().GetProperty("Handled");

                if (!CanHostInsideWebView(uri))
                {
                    if (handledProperty != null) handledProperty.SetValue(args, true, null);
                    TryOpenAllowedExternalProtocol(uri);
                    return;
                }

                MethodInfo getDeferral = args.GetType().GetMethod("GetDeferral", Type.EmptyTypes);
                if (getDeferral == null) throw new InvalidOperationException("WebView2 popup deferral is unavailable.");
                deferral = getDeferral.Invoke(args, null);

                PropertyInfo environmentProperty = sender == null ? null : sender.GetType().GetProperty("Environment");
                object environment = environmentProperty == null ? null : environmentProperty.GetValue(sender, null);
                if (environment == null) throw new InvalidOperationException("Không lấy được WebView2 environment dùng chung cho popup.");

                popup = BuildPopupForm(uri);
                Control popupWebView = (Control)Activator.CreateInstance(webViewType);
                popupWebView.Dock = DockStyle.Fill;
                popupWebView.Margin = new Padding(0);
                popupWebView.Tag = "root";
                popup.Controls.Add(popupWebView);

                bool completed = false;
                Action<bool, object, string> complete = delegate(bool success, object popupCore, string error)
                {
                    if (completed) return;
                    completed = true;
                    try
                    {
                        if (success && popupCore != null)
                        {
                            ConfigureCore(popupCore, popup, false);
                            PropertyInfo newWindow = args.GetType().GetProperty("NewWindow");
                            if (newWindow == null || !newWindow.CanWrite) throw new InvalidOperationException("WebView2 NewWindow không khả dụng.");
                            newWindow.SetValue(args, popupCore, null);
                            if (handledProperty != null) handledProperty.SetValue(args, true, null);
                            WriteRuntimeProbeMarker("POPUP_READY|" + (uri ?? string.Empty));
                        }
                        else
                        {
                            if (handledProperty != null) handledProperty.SetValue(args, true, null);
                            if (!string.IsNullOrWhiteSpace(error)) statusCallback("Không thể mở cửa sổ WebView2: " + error);
                        }
                    }
                    catch (Exception ex)
                    {
                        try { if (handledProperty != null) handledProperty.SetValue(args, true, null); } catch { }
                        statusCallback("Không thể liên kết cửa sổ WebView2: " + ex.Message);
                        success = false;
                    }
                    finally
                    {
                        CompleteDeferral(deferral);
                        if (!success) SafeClosePopup(popup);
                    }
                };

                EventInfo initEvent = webViewType.GetEvent("CoreWebView2InitializationCompleted");
                if (initEvent == null) throw new InvalidOperationException("Thiếu sự kiện khởi tạo WebView2 popup.");
                Delegate initHandler = CreateEventDelegate(initEvent.EventHandlerType, delegate(object initSender, object initArgs)
                {
                    try
                    {
                        if (!ReadInitializationSuccess(initArgs))
                        {
                            complete(false, null, ReadInitializationError(initArgs, "Khởi tạo popup thất bại."));
                            return;
                        }
                        object popupCore = popupWebView.GetType().GetProperty("CoreWebView2").GetValue(popupWebView, null);
                        complete(popupCore != null, popupCore, popupCore == null ? "Popup chưa có CoreWebView2." : null);
                    }
                    catch (Exception ex)
                    {
                        complete(false, null, ex.Message);
                    }
                });
                initEvent.AddEventHandler(popupWebView, initHandler);

                popup.FormClosed += delegate
                {
                    if (!completed) complete(false, null, "Cửa sổ popup đã đóng trước khi khởi tạo xong.");
                };

                Form owner = host.FindForm();
                if (owner != null && owner.Visible) popup.Show(owner); else popup.Show();

                MethodInfo ensure = FindEnsureCoreMethod(webViewType, environment.GetType());
                if (ensure == null) throw new InvalidOperationException("Không tìm thấy EnsureCoreWebView2Async dùng cùng environment.");
                ensure.Invoke(popupWebView, new object[] { environment });
            }
            catch (Exception ex)
            {
                try { if (handledProperty != null) handledProperty.SetValue(args, true, null); } catch { }
                CompleteDeferral(deferral);
                SafeClosePopup(popup);
                statusCallback("Không thể mở popup WebView2: " + ex.Message);
            }
        }

        private Form BuildPopupForm(string uri)
        {
            var popup = new Form
            {
                Text = "HNL QLTC • Đăng nhập / Liên kết",
                StartPosition = FormStartPosition.CenterParent,
                MinimumSize = new Size(720, 560),
                Size = new Size(940, 760),
                AutoScaleMode = AutoScaleMode.Dpi,
                Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point)
            };
            Form owner = host.FindForm();
            try { if (owner != null && owner.Icon != null) popup.Icon = owner.Icon; } catch { }
            Program.DesktopUiTheme.ApplyToForm(popup, Program.DesktopUiTheme.ReadFromSystem());
            return popup;
        }

        private void OnDownloadStarting(object sender, object args)
        {
            try
            {
                PropertyInfo pathProperty = args.GetType().GetProperty("ResultFilePath");
                if (pathProperty == null || !pathProperty.CanWrite) return;

                string existingPath = Convert.ToString(pathProperty.GetValue(args, null));
                string fileName = SanitizeFileName(Path.GetFileName(existingPath));
                if (string.IsNullOrWhiteSpace(fileName))
                    fileName = "HNL-QLTC-download-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".bin";

                string folder = GetDownloadFolder(fileName);
                Directory.CreateDirectory(folder);
                string target = GetUniqueDownloadPath(folder, fileName);
                pathProperty.SetValue(args, target, null);

                PropertyInfo handled = args.GetType().GetProperty("Handled");
                if (handled != null && handled.CanWrite) handled.SetValue(args, true, null);
                WriteRuntimeProbeMarker("DOWNLOAD|" + target);
                statusCallback("Đang tải " + fileName + " vào " + folder + ".");
                if (downloadStatusCallback != null) downloadStatusCallback("started", target, null);
                AttachDownloadStateWatcher(args, target, fileName);
            }
            catch (Exception ex)
            {
                statusCallback("Không thể định tuyến file tải xuống: " + ex.Message);
                if (downloadStatusCallback != null) downloadStatusCallback("failed", null, ex.Message);
            }
        }

        private void AttachDownloadStateWatcher(object args, string target, string fileName)
        {
            try
            {
                PropertyInfo operationProperty = args == null ? null : args.GetType().GetProperty("DownloadOperation");
                object operation = operationProperty == null ? null : operationProperty.GetValue(args, null);
                if (operation == null) return;

                EventInfo stateChanged = operation.GetType().GetEvent("StateChanged");
                if (stateChanged == null) return;

                bool terminalReported = false;
                Action<object, object> callback = delegate
                {
                    if (terminalReported) return;
                    string state = ReadStringProperty(operation, "State");
                    if (string.Equals(state, "Completed", StringComparison.OrdinalIgnoreCase))
                    {
                        terminalReported = true;
                        statusCallback("Đã tải xong " + fileName + " • " + target);
                        if (downloadStatusCallback != null) downloadStatusCallback("completed", target, null);
                    }
                    else if (string.Equals(state, "Interrupted", StringComparison.OrdinalIgnoreCase))
                    {
                        terminalReported = true;
                        string reason = ReadStringProperty(operation, "InterruptReason");
                        statusCallback("Tải file chưa hoàn tất: " + fileName + (string.IsNullOrWhiteSpace(reason) ? "." : " • " + reason));
                        if (downloadStatusCallback != null) downloadStatusCallback("failed", target, reason);
                    }
                };

                stateChanged.AddEventHandler(operation, CreateEventDelegate(stateChanged.EventHandlerType, callback));
            }
            catch (Exception ex)
            {
                statusCallback("Không thể theo dõi trạng thái file tải xuống: " + ex.Message);
            }
        }

        private void OnPermissionRequested(object sender, object args)
        {
            try
            {
                string origin = ReadStringProperty(args, "Uri");
                PropertyInfo kindProperty = args.GetType().GetProperty("PermissionKind");
                PropertyInfo stateProperty = args.GetType().GetProperty("State");
                if (kindProperty == null || stateProperty == null || !stateProperty.CanWrite) return;

                string kind = Convert.ToString(kindProperty.GetValue(args, null));
                if (!string.Equals(kind, "Camera", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(kind, "Microphone", StringComparison.OrdinalIgnoreCase)) return;
                if (!IsHnlAppOrigin(origin)) return;

                string label = string.Equals(kind, "Camera", StringComparison.OrdinalIgnoreCase) ? "camera" : "micro";
                DialogResult result = MessageBox.Show(
                    "HNL QLTC đang yêu cầu quyền sử dụng " + label + ".\n\nCho phép cho thao tác hiện tại?",
                    "HNL QLTC",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );

                object state = Enum.Parse(stateProperty.PropertyType, result == DialogResult.Yes ? "Allow" : "Deny", true);
                stateProperty.SetValue(args, state, null);
                PropertyInfo saves = args.GetType().GetProperty("SavesInProfile");
                if (saves != null && saves.CanWrite) saves.SetValue(args, false, null);
            }
            catch { }
        }

        private void OnNavigationStarting(object sender, object args)
        {
            try
            {
                string uri = ReadStringProperty(args, "Uri");
                if (CanHostInsideWebView(uri)) return;

                PropertyInfo cancel = args.GetType().GetProperty("Cancel");
                if (cancel != null) cancel.SetValue(args, true, null);
                TryOpenAllowedExternalProtocol(uri);
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
                if (success) TryRunCiRuntimeProbe(sender);
            }
            catch { }
        }

        private void OnDocumentTitleChanged(object sender, object args)
        {
            // Native window title stays stable as HNL QLTC; page title remains inside WebView2.
        }

        private void TryRunCiRuntimeProbe(object core)
        {
            string probeFile = Environment.GetEnvironmentVariable("HNL_QLTC_WEBVIEW2_PROBE_FILE");
            if (runtimeProbeStarted || string.IsNullOrWhiteSpace(probeFile) || core == null) return;
            runtimeProbeStarted = true;
            try
            {
                MethodInfo execute = core.GetType().GetMethod("ExecuteScriptAsync", new[] { typeof(string) });
                if (execute == null) throw new InvalidOperationException("ExecuteScriptAsync is unavailable.");
                const string script = @"(function(){
                    try {
                        var popup = window.open('about:blank', '_blank');
                        if (popup) setTimeout(function(){ try { popup.close(); } catch(e) {} }, 800);
                        var blob = new Blob(['HNL QLTC WebView2 runtime probe'], {type:'text/plain'});
                        var url = URL.createObjectURL(blob);
                        var link = document.createElement('a');
                        link.href = url;
                        link.download = 'HNL-WebView2-Runtime-Probe.txt';
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                        setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
                    } catch(e) {}
                })();";
                execute.Invoke(core, new object[] { script });
                WriteRuntimeProbeMarker("SCRIPT_TRIGGERED");
            }
            catch (Exception ex)
            {
                WriteRuntimeProbeMarker("SCRIPT_FAIL|" + ex.GetType().Name + "|" + ex.Message);
            }
        }

        private static void WriteRuntimeProbeMarker(string value)
        {
            string path = Environment.GetEnvironmentVariable("HNL_QLTC_WEBVIEW2_PROBE_FILE");
            if (string.IsNullOrWhiteSpace(path)) return;
            try
            {
                string directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                File.AppendAllText(path, DateTime.UtcNow.ToString("o") + "|" + value + Environment.NewLine);
            }
            catch { }
        }

        private static bool CanHostInsideWebView(string uri)
        {
            if (string.IsNullOrWhiteSpace(uri)) return true;
            Uri parsed;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed)) return false;
            string scheme = parsed.Scheme == null ? string.Empty : parsed.Scheme.ToLowerInvariant();
            return scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob";
        }

        private static bool TryOpenAllowedExternalProtocol(string uri)
        {
            if (string.IsNullOrWhiteSpace(uri)) return false;
            Uri parsed;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed)) return false;
            string scheme = parsed.Scheme == null ? string.Empty : parsed.Scheme.ToLowerInvariant();
            if (scheme != "tel" && scheme != "mailto" && scheme != "sms" && scheme != "zalo") return false;
            try
            {
                Process.Start(new ProcessStartInfo { FileName = uri, UseShellExecute = true });
                return true;
            }
            catch { return false; }
        }

        private static bool IsHnlAppOrigin(string uri)
        {
            try
            {
                Uri request;
                Uri app;
                if (!Uri.TryCreate(uri, UriKind.Absolute, out request)) return false;
                if (!Uri.TryCreate(Program.BuildAppUrl(), UriKind.Absolute, out app)) return false;
                return string.Equals(request.Scheme, app.Scheme, StringComparison.OrdinalIgnoreCase) &&
                       string.Equals(request.Host, app.Host, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private static string GetDownloadFolder(string fileName)
        {
            string extension = Path.GetExtension(fileName).ToLowerInvariant();
            if (extension == ".pdf") return Program.DesktopPaths.Pdf;
            if (extension == ".xlsx" || extension == ".xls" || extension == ".csv") return Program.DesktopPaths.Excel;
            return Program.DesktopPaths.Exports;
        }

        private static string SanitizeFileName(string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return fileName;
            foreach (char invalid in Path.GetInvalidFileNameChars()) fileName = fileName.Replace(invalid, '_');
            return fileName.Trim();
        }

        private static string GetUniqueDownloadPath(string folder, string fileName)
        {
            string baseName = Path.GetFileNameWithoutExtension(fileName);
            string extension = Path.GetExtension(fileName);
            string candidate = Path.Combine(folder, fileName);
            int index = 2;
            while (File.Exists(candidate))
            {
                candidate = Path.Combine(folder, baseName + " (" + index + ")" + extension);
                index++;
            }
            return candidate;
        }

        private static MethodInfo FindEnsureCoreMethod(Type controlType, Type environmentType)
        {
            foreach (MethodInfo method in controlType.GetMethods(BindingFlags.Instance | BindingFlags.Public))
            {
                if (!string.Equals(method.Name, "EnsureCoreWebView2Async", StringComparison.Ordinal)) continue;
                ParameterInfo[] parameters = method.GetParameters();
                if (parameters.Length != 1) continue;
                if (parameters[0].ParameterType.IsAssignableFrom(environmentType) || environmentType.IsAssignableFrom(parameters[0].ParameterType))
                    return method;
            }
            return null;
        }

        private static bool ReadInitializationSuccess(object args)
        {
            if (args == null) return false;
            PropertyInfo successProperty = args.GetType().GetProperty("IsSuccess");
            return successProperty != null && (bool)successProperty.GetValue(args, null);
        }

        private static string ReadInitializationError(object args, string fallback)
        {
            try
            {
                PropertyInfo exceptionProperty = args == null ? null : args.GetType().GetProperty("InitializationException");
                Exception error = exceptionProperty == null ? null : exceptionProperty.GetValue(args, null) as Exception;
                return error == null ? fallback : error.Message;
            }
            catch { return fallback; }
        }

        private static string ReadStringProperty(object target, string propertyName)
        {
            try
            {
                PropertyInfo property = target == null ? null : target.GetType().GetProperty(propertyName);
                return property == null ? null : Convert.ToString(property.GetValue(target, null));
            }
            catch { return null; }
        }

        private static void CompleteDeferral(object deferral)
        {
            if (deferral == null) return;
            try
            {
                MethodInfo complete = deferral.GetType().GetMethod("Complete", Type.EmptyTypes);
                if (complete != null) complete.Invoke(deferral, null);
            }
            catch { }
        }

        private static void SafeClosePopup(Form popup)
        {
            if (popup == null || popup.IsDisposed) return;
            try
            {
                if (popup.InvokeRequired) popup.BeginInvoke((MethodInvoker)popup.Close);
                else popup.Close();
            }
            catch { }
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
