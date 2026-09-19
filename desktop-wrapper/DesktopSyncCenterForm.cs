using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace QLTCAnPhu
{
    internal sealed class DesktopSyncCenterForm : Form
    {
        private readonly DesktopLocalStore store;
        private readonly string workspaceRoot;
        private readonly DataGridView queueGrid;
        private readonly DataGridView historyGrid;
        private readonly Label summaryLabel;
        private readonly Label hintLabel;
        private readonly Label selectionLabel;
        private readonly TabControl tabs;
        private readonly ComboBox stateFilter;
        private readonly TextBox searchBox;
        private readonly System.Windows.Forms.Timer refreshTimer;

        internal DesktopSyncCenterForm(DesktopLocalStore localStore, string root)
        {
            store = localStore;
            workspaceRoot = root;
            Text = "HNL QLTC - Sync Center";
            StartPosition = FormStartPosition.CenterParent;
            MinimumSize = new Size(960, 620);
            Size = new Size(1180, 720);
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(246, 248, 251);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var rootPanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, Padding = new Padding(18) };
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            Controls.Add(rootPanel);

            var header = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(14, 10, 14, 8) };
            rootPanel.Controls.Add(header, 0, 0);
            var title = new Label { AutoSize = true, Text = "Sync Center", Font = new Font("Segoe UI", 17F, FontStyle.Bold), ForeColor = Color.FromArgb(25, 46, 80), Location = new Point(14, 9) };
            header.Controls.Add(title);
            summaryLabel = new Label { AutoSize = true, Text = "Đang tải trạng thái queue...", ForeColor = Color.FromArgb(85, 95, 108), Location = new Point(17, 41) };
            header.Controls.Add(summaryLabel);

            var filters = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 7, 0, 3) };
            rootPanel.Controls.Add(filters, 0, 1);
            filters.Controls.Add(new Label { Text = "Trạng thái:", AutoSize = true, Margin = new Padding(0, 6, 6, 0) });
            stateFilter = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 165 };
            stateFilter.Items.Add(new QueueFilterOption("Tất cả", ""));
            stateFilter.Items.Add(new QueueFilterOption("Chờ xử lý", "pending"));
            stateFilter.Items.Add(new QueueFilterOption("Chờ retry", "retry"));
            stateFilter.Items.Add(new QueueFilterOption("Sẵn sàng Web", "ready_for_app_sync"));
            stateFilter.Items.Add(new QueueFilterOption("Cloud-verified", "completed"));
            stateFilter.SelectedIndex = 0;
            stateFilter.SelectedIndexChanged += delegate { RefreshAll(); };
            filters.Controls.Add(stateFilter);
            filters.Controls.Add(new Label { Text = "Tìm file/lỗi:", AutoSize = true, Margin = new Padding(16, 6, 6, 0) });
            searchBox = new TextBox { Width = 260 };
            searchBox.KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { RefreshAll(); e.SuppressKeyPress = true; } };
            filters.Controls.Add(searchBox);
            filters.Controls.Add(MakeButton("Lọc", delegate { RefreshAll(); }));
            filters.Controls.Add(MakeButton("Xóa lọc", ClearFilters));

            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 8, 0, 4) };
            rootPanel.Controls.Add(actions, 0, 2);
            actions.Controls.Add(MakeButton("Làm mới", delegate { RefreshAll(); }));
            actions.Controls.Add(MakeButton("Chọn tất cả đang lọc", SelectAllVisible));
            actions.Controls.Add(MakeButton("Bỏ chọn", delegate { queueGrid.ClearSelection(); UpdateSelectionLabel(); }));
            actions.Controls.Add(MakeButton("Retry đã chọn (tối đa 50)", RetrySelected));
            actions.Controls.Add(MakeButton("Mở file nguồn", OpenSelectedSource));
            actions.Controls.Add(MakeButton("Mở DesktopBridge", delegate { OpenPath(Program.DesktopPaths.DesktopBridge); }));
            actions.Controls.Add(MakePrimaryButton("Mở Web & đồng bộ", delegate { Program.OpenHnlQltc(); }));

            tabs = new TabControl { Dock = DockStyle.Fill };
            rootPanel.Controls.Add(tabs, 0, 3);

            queueGrid = BuildQueueGrid();
            queueGrid.SelectionChanged += delegate { UpdateSelectionLabel(); };
            var queuePage = new TabPage("Queue") { BackColor = Color.White };
            queuePage.Controls.Add(queueGrid);
            tabs.TabPages.Add(queuePage);

            historyGrid = BuildHistoryGrid();
            var historyPage = new TabPage("Lịch sử") { BackColor = Color.White };
            historyPage.Controls.Add(historyGrid);
            tabs.TabPages.Add(historyPage);

            var footer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 75));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
            rootPanel.Controls.Add(footer, 0, 4);
            hintLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(86, 96, 109),
                Text = "Queue local không tự ghi Cloud. Lịch sử giữ tối đa 90 ngày / 5.000 sự kiện; completed queue giữ 30 ngày."
            };
            footer.Controls.Add(hintLabel, 0, 0);
            selectionLabel = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight, ForeColor = Color.FromArgb(86, 96, 109), Text = "Đã chọn: 0" };
            footer.Controls.Add(selectionLabel, 1, 0);

            refreshTimer = new System.Windows.Forms.Timer { Interval = 5000 };
            refreshTimer.Tick += delegate { if (Visible && !IsDisposed && store != null && !store.IsOperationBusy) RefreshAll(); };
            Shown += delegate { RefreshAll(); refreshTimer.Start(); };
            FormClosed += delegate { refreshTimer.Stop(); refreshTimer.Dispose(); };
        }

        private static Button MakeButton(string text, Action action)
        {
            var button = new Button { Text = text, AutoSize = true, Height = 30, Padding = new Padding(10, 0, 10, 0), FlatStyle = FlatStyle.System };
            button.Click += delegate { SafeAction(action); };
            return button;
        }

        private static Button MakePrimaryButton(string text, Action action)
        {
            var button = MakeButton(text, action);
            button.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            return button;
        }

        private static DataGridView BaseGrid()
        {
            return new DataGridView
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                MultiSelect = true,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                AutoGenerateColumns = false,
                RowHeadersVisible = false,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.None,
                AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.AllCells,
                DefaultCellStyle = new DataGridViewCellStyle { WrapMode = DataGridViewTriState.False, SelectionBackColor = Color.FromArgb(220, 235, 252), SelectionForeColor = Color.Black },
            };
        }

        private static DataGridView BuildQueueGrid()
        {
            var grid = BaseGrid();
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "state", HeaderText = "Trạng thái", Width = 145 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "file", HeaderText = "File / đường dẫn", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, MinimumWidth = 280 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "size", HeaderText = "Dung lượng", Width = 95 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "attempts", HeaderText = "Lần thử", Width = 70 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "updated", HeaderText = "Cập nhật", Width = 145 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "next", HeaderText = "Thử lại", Width = 145 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "error", HeaderText = "Lỗi gần nhất", Width = 220 });
            return grid;
        }

        private static DataGridView BuildHistoryGrid()
        {
            var grid = BaseGrid();
            grid.MultiSelect = false;
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "event", HeaderText = "Sự kiện", Width = 135 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "file", HeaderText = "File / đường dẫn", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, MinimumWidth = 300 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "detail", HeaderText = "Chi tiết", Width = 300 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "time", HeaderText = "Thời gian", Width = 170 });
            return grid;
        }

        private void RefreshAll()
        {
            if (store == null || !store.IsReady)
            {
                summaryLabel.Text = "SQLite chưa sẵn sàng.";
                return;
            }
            store.RefreshBridgeManifest(workspaceRoot);
            store.RunRetentionMaintenanceIfDue();
            PopulateQueue(store.GetQueueRows(500, StateFilterValue(), searchBox.Text));
            PopulateHistory(store.GetHistoryRows(500));
            QueueStats stats = store.GetQueueStats();
            int total = stats.Total;
            int percent = total <= 0 ? 0 : (int)Math.Round((stats.Completed * 100.0) / total);
            summaryLabel.Text = "Chờ: " + stats.Pending + " | Retry: " + stats.Retry + " | Web: " + stats.Ready + " | Xong: " + stats.Completed +
                " | Tiến độ audit: " + percent + "% | Tổng: " + FormatBytes(stats.TotalBytes);
            UpdateSelectionLabel();
        }

        private void PopulateQueue(List<SyncQueueRow> rows)
        {
            queueGrid.Rows.Clear();
            foreach (var row in rows)
            {
                int index = queueGrid.Rows.Add(
                    FriendlyState(row.State),
                    row.RelativePath,
                    FormatBytes(row.SizeBytes),
                    row.Attempts.ToString(),
                    FormatUtc(row.UpdatedUtc),
                    FormatUtc(row.NextAttemptUtc),
                    row.LastError ?? ""
                );
                queueGrid.Rows[index].Tag = row;
            }
        }

        private void PopulateHistory(List<SyncHistoryRow> rows)
        {
            historyGrid.Rows.Clear();
            foreach (var row in rows)
            {
                int index = historyGrid.Rows.Add(FriendlyEvent(row.Event), row.RelativePath, row.Detail ?? "", FormatUtc(row.OccurredUtc));
                historyGrid.Rows[index].Tag = row;
            }
        }

        private void RetrySelected()
        {
            if (tabs.SelectedIndex != 0 || queueGrid.SelectedRows.Count == 0) throw new InvalidOperationException("Hãy chọn ít nhất một mục trong Queue.");
            var keys = new List<string>();
            foreach (DataGridViewRow gridRow in queueGrid.SelectedRows)
            {
                SyncQueueRow row = gridRow.Tag as SyncQueueRow;
                if (row != null && !string.IsNullOrWhiteSpace(row.QueueKey)) keys.Add(row.QueueKey);
            }
            BatchRetryResult result = store.RetryQueueItems(keys, 50);
            RefreshAll();
            hintLabel.Text = "Batch retry: " + result.Retried + " mục; bỏ qua completed: " + result.SkippedCompleted +
                (result.LimitReached ? "; đã chạm giới hạn 50 mục/lần." : ".") + " Background worker sẽ hash lại an toàn.";
        }

        private void OpenSelectedSource()
        {
            SyncQueueRow row = SelectedQueueRow();
            if (row == null) throw new InvalidOperationException("Hãy chọn một mục trong Queue.");
            string root = Path.GetFullPath(workspaceRoot + Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(workspaceRoot, row.RelativePath));
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Đường dẫn queue vượt khỏi Workspace.");
            if (!File.Exists(full)) throw new FileNotFoundException("File nguồn không còn tồn tại.", full);
            Process.Start(new ProcessStartInfo { FileName = "explorer.exe", Arguments = "/select,\"" + full + "\"", UseShellExecute = true });
        }

        private void SelectAllVisible()
        {
            if (tabs.SelectedIndex != 0) tabs.SelectedIndex = 0;
            queueGrid.ClearSelection();
            foreach (DataGridViewRow row in queueGrid.Rows) row.Selected = true;
            UpdateSelectionLabel();
        }

        private void ClearFilters()
        {
            stateFilter.SelectedIndex = 0;
            searchBox.Text = "";
            RefreshAll();
        }

        private string StateFilterValue()
        {
            QueueFilterOption option = stateFilter.SelectedItem as QueueFilterOption;
            return option == null ? "" : option.Value;
        }

        private void UpdateSelectionLabel()
        {
            if (selectionLabel != null) selectionLabel.Text = "Đã chọn: " + queueGrid.SelectedRows.Count;
        }

        private SyncQueueRow SelectedQueueRow()
        {
            if (tabs.SelectedIndex != 0 || queueGrid.SelectedRows.Count == 0) return null;
            return queueGrid.SelectedRows[0].Tag as SyncQueueRow;
        }

        private static string FriendlyState(string state)
        {
            if (state == "pending") return "Chờ xử lý";
            if (state == "retry") return "Chờ retry";
            if (state == "ready_for_app_sync") return "Sẵn sàng Web";
            if (state == "completed") return "Cloud-verified";
            return state ?? "";
        }

        private static string FriendlyEvent(string value)
        {
            if (value == "prepared") return "Đã chuẩn bị";
            if (value == "retry") return "Lỗi / retry";
            if (value == "manual_retry") return "Retry thủ công";
            if (value == "cloud_verified") return "Cloud-verified";
            return value ?? "";
        }

        private static string FormatUtc(string raw)
        {
            DateTime parsed;
            if (DateTime.TryParse(raw, null, System.Globalization.DateTimeStyles.RoundtripKind, out parsed)) return parsed.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss");
            return raw ?? "";
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024L * 1024L) return (bytes / 1024d).ToString("0.0") + " KB";
            if (bytes < 1024L * 1024L * 1024L) return (bytes / (1024d * 1024d)).ToString("0.0") + " MB";
            return (bytes / (1024d * 1024d * 1024d)).ToString("0.00") + " GB";
        }

        private static void OpenPath(string path)
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }

        private static void SafeAction(Action action)
        {
            try { action(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "HNL QLTC - Sync Center", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        private sealed class QueueFilterOption
        {
            internal string Caption;
            internal string Value;
            internal QueueFilterOption(string caption, string value) { Caption = caption; Value = value; }
            public override string ToString() { return Caption; }
        }
    }
}
