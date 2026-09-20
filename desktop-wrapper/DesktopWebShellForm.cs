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
        private readonly Button compactButton;
        private readonly ToolTip chromeToolTip;
        private readonly DesktopLocalStore localStore;
        private readonly NotifyIcon trayIcon;
        private readonly System.Windows.Forms.Timer maintenanceTimer;
        private readonly ContextMenuStrip moreMenu;
        private Program.DesktopUiTheme theme;
        private EmbeddedWebViewRuntime embeddedRuntime;
        private bool webInitializationStarted;
        private bool allowClose;
        private bool compactChrome;
        private FormWindowState restoreWindowState = FormWindowState.Normal;
        private int maintenanceRunning;

        private const float NormalHeaderHeight = 54F;
        private const float CompactHeaderHeight = 40F;
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
                Padding = new Padding(14, 8, 14, 8),
                Margin = new Padding(0),
                Tag = "header"
            };
            rootLayout.Controls.Add(toolbarPanel, 0, 0);

            if (Icon != null)
            {
                brandLogo = new PictureBox
                {
                    Size = new Size(32, 32),
                    Location = new Point(14, 11),
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Image = Icon.ToBitmap(),
                    BackColor = Color.Transparent
                };
                toolbarPanel.Controls.Add(brandLogo);
            }

            brandLabel = new Label
            {
                AutoSize = true,
                Text = "HNL QLTC",
                Font = new Font("Segoe UI", 12.5F, FontStyle.Bold),
                Location = new Point(54, 8),
                Tag = "title"
            };
            toolbarPanel.Controls.Add(brandLabel);

            releaseLabel = new Label
            {
                AutoSize = true,
                Text = Program.GetReleaseTag(),
                Font = new Font("Segoe UI", 8.25F, FontStyle.Bold),
                Location = new Point(55, 31),
                Tag = "subtle"
            };
            toolbarPanel.Controls.Add(releaseLabel);

            navPanel = new FlowLayoutPanel
            {
                AutoSize = true,
                Height = 38,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Location = new Point(190, 8),
                Padding = new Padding(0),
                Margin = new Padding(0),
                Tag = "header"
            };
            navPanel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            toolbarPanel.Controls.Add(navPanel);
            toolbarPanel.Resize += delegate { PositionToolbarActions(); };

            syncButton = MakeToolbarPrimaryButton("✓  Đồng bộ", 112);
            syncButton.AccessibleName = "Trạng thái đồng bộ";
            syncButton.Click += delegate { ShowSyncMenu(); };
            navPanel.Controls.Add(syncButton);

            var reloadButton = MakeToolbarButton("↻", 40);
            reloadButton.Font = new Font("Segoe UI", 13F, FontStyle.Bold);
            reloadButton.AccessibleName = "Tải lại HNL QLTC";
            reloadButton.Click += delegate
            {
                ShowWebApp();
                if (embeddedRuntime != null) embeddedRuntime.Reload();
            };
            navPanel.Controls.Add(reloadButton);

            var moreButton = MakeToolbarButton("⋯", 40);
            moreButton.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            moreButton.AccessibleName = "Tùy chọn khác";
            navPanel.Controls.Add(moreButton);

            compactButton = MakeToolbarButton("▴", 38);
            compactButton.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
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
            moreButton.Click += delegate
            {
                moreMenu.Show(moreButton, new Point(0, moreButton.Height + 2));
            };
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
        private bool runtimeProbeStarted;
        private string runtimeDirectory;
        private Type webViewType;

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
            }
            catch (Exception ex)
            {
                statusCallback("Không thể định tuyến file tải xuống: " + ex.Message);
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
