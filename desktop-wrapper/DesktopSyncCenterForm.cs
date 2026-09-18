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
        private readonly TabControl tabs;

        internal DesktopSyncCenterForm(DesktopLocalStore localStore, string root)
        {
            store = localStore;
            workspaceRoot = root;
            Text = "HNL QLTC - Sync Center";
            StartPosition = FormStartPosition.CenterParent;
            MinimumSize = new Size(900, 560);
            Size = new Size(1080, 680);
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(246, 248, 251);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var rootPanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, Padding = new Padding(18) };
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            rootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            Controls.Add(rootPanel);

            var header = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(14, 10, 14, 8) };
            rootPanel.Controls.Add(header, 0, 0);
            var title = new Label { AutoSize = true, Text = "Sync Center", Font = new Font("Segoe UI", 17F, FontStyle.Bold), ForeColor = Color.FromArgb(25, 46, 80), Location = new Point(14, 9) };
            header.Controls.Add(title);
            summaryLabel = new Label { AutoSize = true, Text = "Đang tải trạng thái queue...", ForeColor = Color.FromArgb(85, 95, 108), Location = new Point(17, 39) };
            header.Controls.Add(summaryLabel);

            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 8, 0, 4) };
            rootPanel.Controls.Add(actions, 0, 1);
            actions.Controls.Add(MakeButton("Làm mới", delegate { RefreshAll(); }));
            actions.Controls.Add(MakeButton("Retry mục chọn", RetrySelected));
            actions.Controls.Add(MakeButton("Mở file nguồn", OpenSelectedSource));
            actions.Controls.Add(MakeButton("Mở DesktopBridge", delegate { OpenPath(Program.DesktopPaths.DesktopBridge); }));
            actions.Controls.Add(MakePrimaryButton("Mở Web & đồng bộ", delegate { Program.OpenHnlQltc(); }));

            tabs = new TabControl { Dock = DockStyle.Fill };
            rootPanel.Controls.Add(tabs, 0, 2);

            queueGrid = BuildQueueGrid();
            var queuePage = new TabPage("Queue") { BackColor = Color.White };
            queuePage.Controls.Add(queueGrid);
            tabs.TabPages.Add(queuePage);

            historyGrid = BuildHistoryGrid();
            var historyPage = new TabPage("Lịch sử") { BackColor = Color.White };
            historyPage.Controls.Add(historyGrid);
            tabs.TabPages.Add(historyPage);

            hintLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(86, 96, 109),
                Text = "Queue local không tự ghi Cloud. ready_for_app_sync chỉ được hoàn tất khi Web App tạo ACK Cloud-verified."
            };
            rootPanel.Controls.Add(hintLabel, 0, 3);

            Shown += delegate { RefreshAll(); };
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
                MultiSelect = false,
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
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "attempts", HeaderText = "Lần thử", Width = 70 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "updated", HeaderText = "Cập nhật", Width = 155 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "next", HeaderText = "Thử lại", Width = 155 });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "error", HeaderText = "Lỗi gần nhất", Width = 220 });
            return grid;
        }

        private static DataGridView BuildHistoryGrid()
        {
            var grid = BaseGrid();
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
            PopulateQueue(store.GetQueueRows(500));
            PopulateHistory(store.GetHistoryRows(500));
            summaryLabel.Text = "Pending/Retry: " + store.CountQueuePending() +
                "  |  Sẵn sàng Web: " + store.CountQueueReady() +
                "  |  Hoàn tất: " + store.CountQueueCompleted() +
                "  |  Lịch sử: " + store.CountHistory();
        }

        private void PopulateQueue(List<SyncQueueRow> rows)
        {
            queueGrid.Rows.Clear();
            foreach (var row in rows)
            {
                int index = queueGrid.Rows.Add(
                    FriendlyState(row.State),
                    row.RelativePath,
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
            SyncQueueRow row = SelectedQueueRow();
            if (row == null) throw new InvalidOperationException("Hãy chọn một mục trong Queue.");
            if (row.State == "completed") throw new InvalidOperationException("Mục này đã Cloud-verified và hoàn tất; không retry để tránh tạo bản ghi trùng.");
            if (!store.RetryQueueItem(row.QueueKey)) throw new InvalidOperationException("Không thể đưa mục đã chọn về hàng đợi.");
            store.ProcessOneQueueItem(workspaceRoot);
            store.RefreshBridgeManifest(workspaceRoot);
            RefreshAll();
            hintLabel.Text = "Đã retry local preparation. Nếu trạng thái thành ready_for_app_sync, mở Web để thực hiện Auth/RBAC + Cloud upload.";
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
    }
}
