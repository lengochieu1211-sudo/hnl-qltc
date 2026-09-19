using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace QLTCAnPhu
{
    internal sealed class DesktopLocalStore : IDisposable
    {
        private const int SQLITE_OK = 0;
        private const int SQLITE_OPEN_READWRITE = 0x00000002;
        private const int SQLITE_OPEN_CREATE = 0x00000004;
        private const int SQLITE_OPEN_FULLMUTEX = 0x00010000;

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int SqliteCallback(IntPtr userData, int columnCount, IntPtr values, IntPtr names);

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int sqlite3_open_v2(IntPtr filename, out IntPtr db, int flags, IntPtr vfs);

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int sqlite3_close_v2(IntPtr db);

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int sqlite3_exec(IntPtr db, IntPtr sql, SqliteCallback callback, IntPtr userData, out IntPtr errorMessage);

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern void sqlite3_free(IntPtr pointer);

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int sqlite3_busy_timeout(IntPtr db, int milliseconds);

        private readonly object gate = new object();
        private readonly object operationGate = new object();
        private IntPtr db;

        internal string DatabasePath { get; private set; }
        internal bool IsReady { get { return db != IntPtr.Zero; } }
        internal string LastError { get; private set; }
        internal bool IsOperationBusy
        {
            get
            {
                if (!Monitor.TryEnter(operationGate)) return true;
                Monitor.Exit(operationGate);
                return false;
            }
        }

        internal static DesktopLocalStore TryOpen(string databasePath)
        {
            var store = new DesktopLocalStore();
            store.DatabasePath = databasePath;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(databasePath));
                store.Open();
                store.EnsureSchema();
                store.RunRetentionMaintenanceIfDue();
            }
            catch (Exception ex)
            {
                store.LastError = ex.Message;
                store.Dispose();
            }
            return store;
        }

        private void Open()
        {
            using (var utf8 = new Utf8String(DatabasePath))
            {
                int code = sqlite3_open_v2(
                    utf8.Pointer,
                    out db,
                    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                    IntPtr.Zero
                );
                if (code != SQLITE_OK || db == IntPtr.Zero)
                {
                    throw new InvalidOperationException("Không mở được SQLite local workspace (code " + code + ").");
                }
            }
            sqlite3_busy_timeout(db, 5000);
        }

        private void EnsureSchema()
        {
            Exec("PRAGMA journal_mode=WAL;");
            Exec("PRAGMA synchronous=NORMAL;");
            Exec("PRAGMA foreign_keys=ON;");
            Exec(@"
CREATE TABLE IF NOT EXISTS desktop_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_files (
  relative_path TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_utc TEXT NOT NULL,
  sha256 TEXT,
  scan_token TEXT NOT NULL,
  indexed_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_files_area ON workspace_files(area);
CREATE TABLE IF NOT EXISTS sync_queue (
  queue_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_utc TEXT,
  created_utc TEXT NOT NULL,
  updated_utc TEXT NOT NULL,
  last_error TEXT,
  bridge_nonce TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_state ON sync_queue(state, next_attempt_utc);
CREATE TABLE IF NOT EXISTS sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  occurred_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_history_occurred ON sync_history(occurred_utc DESC);
");
            EnsureSyncQueueBridgeNonceColumn();
            Exec("UPDATE sync_queue SET state='pending', next_attempt_utc=COALESCE(next_attempt_utc,updated_utc), bridge_nonce=NULL WHERE state='ready_for_app_sync' AND (bridge_nonce IS NULL OR bridge_nonce='');");
            SetMeta("schema_version", "4");
            SetMeta("cloud_authority", "Firestore business data + Cloudflare R2 binary; SQLite is local mirror/cache only");
        }

        internal WorkspaceIndexResult RefreshIndex(string workspaceRoot)
        {
            lock (operationGate)
            {
            if (!IsReady) throw new InvalidOperationException("SQLite local workspace chưa sẵn sàng.");
            var result = new WorkspaceIndexResult();
            string scanToken = Guid.NewGuid().ToString("N");
            string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            var roots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "Backup", Path.Combine(workspaceRoot, "Backup") },
                { "Imports", Path.Combine(workspaceRoot, "Imports") },
                { "Exports", Path.Combine(workspaceRoot, "Exports") },
                { "Reports", Path.Combine(workspaceRoot, "Reports") },
                { "Photos", Path.Combine(workspaceRoot, "Photos") },
                { "Diagnostics", Path.Combine(workspaceRoot, "Diagnostics") }
            };

            Exec("BEGIN IMMEDIATE;");
            try
            {
                bool scanComplete = true;
                foreach (var root in roots)
                {
                    Directory.CreateDirectory(root.Value);
                    bool rootScanComplete;
                    foreach (string filePath in EnumerateFilesSafe(root.Value, out rootScanComplete))
                    {
                        var file = new FileInfo(filePath);
                        string relative = MakeRelativePath(workspaceRoot, file.FullName);
                        string modified = file.LastWriteTimeUtc.ToString("o", CultureInfo.InvariantCulture);
                        string previousSignature = ScalarText(
                            "SELECT CAST(size_bytes AS TEXT) || '|' || modified_utc FROM workspace_files WHERE relative_path=" + Sql(relative) + " LIMIT 1;"
                        );
                        string previousHash = ScalarText(
                            "SELECT COALESCE(sha256,'') FROM workspace_files WHERE relative_path=" + Sql(relative) + " LIMIT 1;"
                        );
                        string signature = file.Length.ToString(CultureInfo.InvariantCulture) + "|" + modified;
                        bool changed = !string.Equals(previousSignature, signature, StringComparison.Ordinal);

                        Exec(
                            "INSERT OR REPLACE INTO workspace_files(relative_path,area,size_bytes,modified_utc,sha256,scan_token,indexed_utc) VALUES(" +
                            Sql(relative) + "," + Sql(root.Key) + "," + file.Length.ToString(CultureInfo.InvariantCulture) + "," +
                            Sql(modified) + "," + (changed || string.IsNullOrEmpty(previousHash) ? "NULL" : Sql(previousHash)) + "," +
                            Sql(scanToken) + "," + Sql(now) + ");"
                        );
                        result.IndexedFiles += 1;
                        result.TotalBytes += file.Length;

                        if (changed && (root.Key == "Imports" || root.Key == "Photos"))
                        {
                            EnqueueLocalPreparation(relative, now);
                            result.EnqueuedFiles += 1;
                        }
                    }
                    if (!rootScanComplete) scanComplete = false;
                }

                result.ScanIncomplete = !scanComplete;
                if (scanComplete)
                {
                    result.RemovedFiles = ScalarInt("SELECT COUNT(*) FROM workspace_files WHERE scan_token<>" + Sql(scanToken) + ";");
                    Exec("DELETE FROM workspace_files WHERE scan_token<>" + Sql(scanToken) + ";");
                    Exec("DELETE FROM sync_queue WHERE relative_path NOT IN (SELECT relative_path FROM workspace_files) AND state<>'completed';");
                }
                SetMeta("last_index_utc", now);
                Exec("COMMIT;");
                RefreshBridgeManifest(workspaceRoot);
            }
            catch
            {
                try { Exec("ROLLBACK;"); } catch { }
                throw;
            }
            return result;
        }

            }

        private void EnqueueLocalPreparation(string relativePath, string now)
        {
            string key = "prepare:" + relativePath.ToLowerInvariant();
            Exec(
                "INSERT OR REPLACE INTO sync_queue(queue_key,operation,relative_path,state,attempts,next_attempt_utc,created_utc,updated_utc,last_error) VALUES(" +
                Sql(key) + ",'prepare_binary'," + Sql(relativePath) + ",'pending',0," + Sql(now) + "," +
                "COALESCE((SELECT created_utc FROM sync_queue WHERE queue_key=" + Sql(key) + ")," + Sql(now) + ")," + Sql(now) + ",NULL);"
            );
        }

        internal BackgroundQueueResult ProcessOneQueueItem(string workspaceRoot)
        {
            lock (operationGate)
            {
            var result = new BackgroundQueueResult();
            if (!IsReady) return result;
            string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            string relative = ScalarText(
                "SELECT relative_path FROM sync_queue WHERE state IN ('pending','retry') AND (next_attempt_utc IS NULL OR next_attempt_utc<=" + Sql(now) + ") ORDER BY created_utc LIMIT 1;"
            );
            if (string.IsNullOrEmpty(relative)) return result;

            result.RelativePath = relative;
            string key = "prepare:" + relative.ToLowerInvariant();
            try
            {
                string fullPath = Path.GetFullPath(Path.Combine(workspaceRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
                string fullRoot = Path.GetFullPath(workspaceRoot + Path.DirectorySeparatorChar);
                if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Queue path vượt khỏi workspace.");
                if (!File.Exists(fullPath))
                    throw new FileNotFoundException("File staging không còn tồn tại.", fullPath);

                string hash = ComputeSha256(fullPath);
                string bridgeNonce = Guid.NewGuid().ToString("N");
                Exec("UPDATE workspace_files SET sha256=" + Sql(hash) + ", indexed_utc=" + Sql(now) + " WHERE relative_path=" + Sql(relative) + ";");
                Exec("UPDATE sync_queue SET state='ready_for_app_sync', updated_utc=" + Sql(now) + ", last_error=NULL, bridge_nonce=" + Sql(bridgeNonce) + " WHERE queue_key=" + Sql(key) + ";");
                AddHistory(key, relative, "prepared", "SHA-256 ready for Web App Sync Bridge", now);
                RefreshBridgeManifest(workspaceRoot);
                result.Processed = true;
                result.HashSha256 = hash;
            }
            catch (Exception ex)
            {
                int attempts = ScalarInt("SELECT attempts FROM sync_queue WHERE queue_key=" + Sql(key) + ";") + 1;
                DateTime retry = DateTime.UtcNow.AddSeconds(Math.Min(300, 5 * Math.Pow(2, Math.Min(attempts, 6))));
                Exec(
                    "UPDATE sync_queue SET state='retry', attempts=" + attempts.ToString(CultureInfo.InvariantCulture) +
                    ", next_attempt_utc=" + Sql(retry.ToString("o", CultureInfo.InvariantCulture)) +
                    ", updated_utc=" + Sql(now) + ", last_error=" + Sql(ex.Message) + " WHERE queue_key=" + Sql(key) + ";"
                );
                AddHistory(key, relative, "retry", ex.Message, now);
                result.Error = ex.Message;
            }
            return result;
        }

            }

        internal void RefreshBridgeManifest(string workspaceRoot)
        {
            lock (operationGate)
            {
            if (!IsReady) return;
            string bridgeRoot = Path.Combine(workspaceRoot, "DesktopBridge");
            string ackRoot = Path.Combine(bridgeRoot, "acks");
            Directory.CreateDirectory(bridgeRoot);
            Directory.CreateDirectory(ackRoot);

            var rows = new List<DesktopBridgeItem>();
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count < 4) return 0;
                string key = PtrToStringUtf8(Marshal.ReadIntPtr(values, 0));
                string relative = PtrToStringUtf8(Marshal.ReadIntPtr(values, IntPtr.Size));
                string sha = PtrToStringUtf8(Marshal.ReadIntPtr(values, IntPtr.Size * 2));
                string bridgeNonce = PtrToStringUtf8(Marshal.ReadIntPtr(values, IntPtr.Size * 3));
                DesktopBridgeItem parsed;
                if (TryParseBridgePhotoItem(key, relative, sha, bridgeNonce, out parsed)) rows.Add(parsed);
                return 0;
            };
            Exec("SELECT q.queue_key,q.relative_path,COALESCE(f.sha256,''),COALESCE(q.bridge_nonce,'') FROM sync_queue q JOIN workspace_files f ON f.relative_path=q.relative_path WHERE q.state='ready_for_app_sync' AND COALESCE(q.bridge_nonce,'')<>'' ORDER BY q.created_utc;", callback);

            foreach (var row in rows)
            {
                string ackPath = Path.Combine(ackRoot, row.AckName);
                if (!File.Exists(ackPath)) continue;
                if (!IsValidBridgeAck(ackPath, row)) continue;
                string completedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                AddHistory(row.QueueKey, row.RelativePath, "cloud_verified", "Web App Sync Bridge ACK received", completedAt);
                Exec("UPDATE sync_queue SET state='completed', updated_utc=" + Sql(completedAt) + ", last_error=NULL WHERE queue_key=" + Sql(row.QueueKey) + ";");
                try { File.Delete(ackPath); } catch { }
            }

            rows.Clear();
            Exec("SELECT q.queue_key,q.relative_path,COALESCE(f.sha256,''),COALESCE(q.bridge_nonce,'') FROM sync_queue q JOIN workspace_files f ON f.relative_path=q.relative_path WHERE q.state='ready_for_app_sync' AND COALESCE(q.bridge_nonce,'')<>'' ORDER BY q.created_utc;", callback);
            string manifestPath = Path.Combine(bridgeRoot, "ready.json");
            string tmpPath = manifestPath + ".tmp";
            var json = new StringBuilder();
            json.Append("{\n  \"schema\": \"hnl-qltc-desktop-sync-v1\",\n  \"generatedAt\": \"")
                .Append(JsonEscape(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)))
                .Append("\",\n  \"cloudAuthority\": \"Web app Firebase Auth/RBAC + existing R2 upload pipeline\",\n  \"items\": [\n");
            for (int i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                json.Append("    {\"queueKey\":\"").Append(JsonEscape(row.QueueKey))
                    .Append("\",\"relativePath\":\"").Append(JsonEscape(row.RelativePath.Replace('\\', '/')))
                    .Append("\",\"sourceSha256\":\"").Append(JsonEscape(row.SourceSha256))
                    .Append("\",\"attemptToken\":\"").Append(JsonEscape(row.AttemptToken))
                    .Append("\",\"photoId\":\"").Append(JsonEscape(row.ExpectedPhotoId))
                    .Append("\",\"projectId\":\"").Append(JsonEscape(row.ProjectId))
                    .Append("\",\"entityType\":\"").Append(JsonEscape(row.EntityType))
                    .Append("\",\"entityId\":\"").Append(JsonEscape(row.EntityId))
                    .Append("\",\"category\":\"").Append(JsonEscape(row.Category))
                    .Append("\",\"fileName\":\"").Append(JsonEscape(row.FileName))
                    .Append("\",\"mimeType\":\"").Append(JsonEscape(row.MimeType))
                    .Append("\",\"ackName\":\"").Append(JsonEscape(row.AckName)).Append("\"}");
                if (i + 1 < rows.Count) json.Append(',');
                json.Append('\n');
            }
            json.Append("  ]\n}\n");
            File.WriteAllText(tmpPath, json.ToString(), new UTF8Encoding(false));
            if (File.Exists(manifestPath)) File.Delete(manifestPath);
            File.Move(tmpPath, manifestPath);
        }

            }

        private static bool TryParseBridgePhotoItem(string queueKey, string relativePath, string sha256, string bridgeNonce, out DesktopBridgeItem item)
        {
            item = null;
            if (string.IsNullOrWhiteSpace(sha256) || sha256.Length != 64) return false;
            if (string.IsNullOrWhiteSpace(bridgeNonce) || bridgeNonce.Length != 32 || !Regex.IsMatch(bridgeNonce, "^[a-f0-9]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return false;
            string normalized = relativePath.Replace('\\', '/').Trim('/');
            string[] parts = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            // Canonical bridge staging path:
            // Photos/<projectId>/<defect|crewRecord|chat>/<entityId>/<category>/<file>
            if (parts.Length < 6 || !string.Equals(parts[0], "Photos", StringComparison.OrdinalIgnoreCase)) return false;
            string entityType = parts[2];
            if (entityType != "defect" && entityType != "crewRecord" && entityType != "chat") return false;
            string category = parts[4];
            if (!IsAllowedPhotoCategory(entityType, category)) return false;
            string fileName = parts[parts.Length - 1];
            string mime = GuessImageMime(fileName);
            if (string.IsNullOrEmpty(mime)) return false;
            item = new DesktopBridgeItem
            {
                QueueKey = queueKey,
                RelativePath = relativePath,
                SourceSha256 = sha256.ToLowerInvariant(),
                AttemptToken = bridgeNonce.ToLowerInvariant(),
                ProjectId = parts[1],
                EntityType = entityType,
                EntityId = parts[3],
                Category = category,
                FileName = fileName,
                MimeType = mime,
            };
            item.ExpectedPhotoId = ComputeBridgePhotoId(item);
            item.AckName = item.SourceSha256 + "-" + ComputeStringSha256(queueKey).Substring(0, 16) + ".ack";
            return true;
        }

        private static bool IsValidBridgeAck(string ackPath, DesktopBridgeItem row)
        {
            try
            {
                string json = File.ReadAllText(ackPath, Encoding.UTF8);
                if (!JsonStringFieldEquals(json, "schema", "hnl-qltc-desktop-sync-ack-v1")) return false;
                if (!JsonStringFieldEquals(json, "queueKey", row.QueueKey)) return false;
                if (!JsonStringFieldEquals(json, "sourceSha256", row.SourceSha256)) return false;
                if (!JsonStringFieldEquals(json, "attemptToken", row.AttemptToken)) return false;
                if (!JsonStringFieldEquals(json, "photoId", row.ExpectedPhotoId)) return false;
                if (!JsonStringFieldEquals(json, "projectId", row.ProjectId)) return false;
                if (!JsonBoolFieldEquals(json, "cloudVerified", true)) return false;
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool JsonStringFieldEquals(string json, string fieldName, string expected)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(fieldName)) return false;
            string token = "\"" + fieldName + "\"";
            int fieldIndex = json.IndexOf(token, StringComparison.Ordinal);
            if (fieldIndex < 0) return false;
            int colon = json.IndexOf(':', fieldIndex + token.Length);
            if (colon < 0) return false;
            int cursor = colon + 1;
            while (cursor < json.Length && char.IsWhiteSpace(json[cursor])) cursor++;
            if (cursor >= json.Length || json[cursor] != '"') return false;
            cursor++;
            int valueStart = cursor;
            bool escaped = false;
            while (cursor < json.Length)
            {
                char ch = json[cursor];
                if (ch == '"' && !escaped)
                {
                    string raw = json.Substring(valueStart, cursor - valueStart);
                    return string.Equals(raw, JsonEscape(expected ?? ""), StringComparison.Ordinal);
                }
                if (ch == '\\' && !escaped) escaped = true;
                else escaped = false;
                cursor++;
            }
            return false;
        }

        private static bool JsonBoolFieldEquals(string json, string fieldName, bool expected)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(fieldName)) return false;
            string token = "\"" + fieldName + "\"";
            int fieldIndex = json.IndexOf(token, StringComparison.Ordinal);
            if (fieldIndex < 0) return false;
            int colon = json.IndexOf(':', fieldIndex + token.Length);
            if (colon < 0) return false;
            int cursor = colon + 1;
            while (cursor < json.Length && char.IsWhiteSpace(json[cursor])) cursor++;
            string literal = expected ? "true" : "false";
            if (cursor + literal.Length > json.Length) return false;
            return string.Equals(json.Substring(cursor, literal.Length), literal, StringComparison.OrdinalIgnoreCase);
        }

        private static string ComputeBridgePhotoId(DesktopBridgeItem item)
        {
            string identity = string.Join("|", new[] { item.ProjectId, item.EntityType, item.EntityId, item.Category, item.QueueKey, item.SourceSha256.ToLowerInvariant() });
            return "bridge-" + ComputeStringSha256(identity);
        }

        private static bool IsAllowedPhotoCategory(string entityType, string category)
        {
            if (entityType == "defect") return category == "defect_before" || category == "defect_after";
            if (entityType == "crewRecord") return category == "crew_progress";
            if (entityType == "chat") return category == "chat_attachment";
            return false;
        }

        private static string GuessImageMime(string fileName)
        {
            string ext = Path.GetExtension(fileName).ToLowerInvariant();
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".png") return "image/png";
            if (ext == ".webp") return "image/webp";
            if (ext == ".gif") return "image/gif";
            if (ext == ".bmp") return "image/bmp";
            return "";
        }

        private static string ComputeStringSha256(string text)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        private static string JsonEscape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        internal List<SyncQueueRow> GetQueueRows(int limit)
        {
            return GetQueueRows(limit, "", "");
        }

        internal List<SyncQueueRow> GetQueueRows(int limit, string stateFilter, string searchText)
        {
            lock (operationGate)
            {
                var rows = new List<SyncQueueRow>();
                if (!IsReady) return rows;
                int safeLimit = Math.Max(1, Math.Min(limit, 1000));
                string where = "1=1";
                string safeState = NormalizeQueueStateFilter(stateFilter);
                if (!string.IsNullOrEmpty(safeState)) where += " AND q.state=" + Sql(safeState);
                string search = (searchText ?? "").Trim();
                if (!string.IsNullOrEmpty(search))
                {
                    string like = "%" + search + "%";
                    where += " AND (q.relative_path LIKE " + Sql(like) + " OR COALESCE(q.last_error,'') LIKE " + Sql(like) + ")";
                }
                SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
                {
                    if (count < 9) return 0;
                    rows.Add(new SyncQueueRow
                    {
                        QueueKey = ValueAt(values, 0),
                        RelativePath = ValueAt(values, 1),
                        State = ValueAt(values, 2),
                        Attempts = ParseInt(ValueAt(values, 3)),
                        NextAttemptUtc = ValueAt(values, 4),
                        UpdatedUtc = ValueAt(values, 5),
                        LastError = ValueAt(values, 6),
                        Sha256 = ValueAt(values, 7),
                        SizeBytes = ParseLong(ValueAt(values, 8)),
                    });
                    return 0;
                };
                Exec("SELECT q.queue_key,q.relative_path,q.state,CAST(q.attempts AS TEXT),COALESCE(q.next_attempt_utc,''),q.updated_utc,COALESCE(q.last_error,''),COALESCE(f.sha256,''),CAST(COALESCE(f.size_bytes,0) AS TEXT) FROM sync_queue q LEFT JOIN workspace_files f ON f.relative_path=q.relative_path WHERE " + where + " ORDER BY CASE q.state WHEN 'retry' THEN 0 WHEN 'pending' THEN 1 WHEN 'ready_for_app_sync' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,q.updated_utc DESC LIMIT " + safeLimit.ToString(CultureInfo.InvariantCulture) + ";", callback);
                return rows;
            }
        }

        internal List<SyncHistoryRow> GetHistoryRows(int limit)
        {
            lock (operationGate)
            {
            var rows = new List<SyncHistoryRow>();
            if (!IsReady) return rows;
            int safeLimit = Math.Max(1, Math.Min(limit, 1000));
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count < 5) return 0;
                rows.Add(new SyncHistoryRow
                {
                    QueueKey = ValueAt(values, 0),
                    RelativePath = ValueAt(values, 1),
                    Event = ValueAt(values, 2),
                    Detail = ValueAt(values, 3),
                    OccurredUtc = ValueAt(values, 4),
                });
                return 0;
            };
            Exec("SELECT queue_key,relative_path,event,COALESCE(detail,''),occurred_utc FROM sync_history ORDER BY occurred_utc DESC,id DESC LIMIT " + safeLimit.ToString(CultureInfo.InvariantCulture) + ";", callback);
            return rows;
        }

            }

        internal bool RetryQueueItem(string queueKey)
        {
            lock (operationGate)
            {
            if (!IsReady || string.IsNullOrWhiteSpace(queueKey)) return false;
            string relative = ScalarText("SELECT relative_path FROM sync_queue WHERE queue_key=" + Sql(queueKey) + " LIMIT 1;");
            if (string.IsNullOrEmpty(relative)) return false;
            string state = ScalarText("SELECT state FROM sync_queue WHERE queue_key=" + Sql(queueKey) + " LIMIT 1;");
            if (state == "completed") return false;
            string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            Exec("UPDATE sync_queue SET state='pending',attempts=0,bridge_nonce=NULL,next_attempt_utc=" + Sql(now) + ",updated_utc=" + Sql(now) + ",last_error=NULL WHERE queue_key=" + Sql(queueKey) + ";");
            AddHistory(queueKey, relative, "manual_retry", "User requested retry from Sync Center", now);
            return true;
        }

            }

        internal int CountQueueCompleted()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_queue WHERE state='completed';") : 0;
        }

            }

        internal int CountHistory()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_history;") : 0;
        }

            }

        private void AddHistory(string queueKey, string relativePath, string eventName, string detail, string occurredUtc)
        {
            Exec("INSERT INTO sync_history(queue_key,relative_path,event,detail,occurred_utc) VALUES(" + Sql(queueKey) + "," + Sql(relativePath) + "," + Sql(eventName) + "," + Sql(detail ?? "") + "," + Sql(occurredUtc) + ");");
        }

        private static string ValueAt(IntPtr values, int index)
        {
            IntPtr pointer = Marshal.ReadIntPtr(values, index * IntPtr.Size);
            return pointer == IntPtr.Zero ? "" : PtrToStringUtf8(pointer);
        }

        private static int ParseInt(string value)
        {
            int parsed;
            return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : 0;
        }

        private static long ParseLong(string value)
        {
            long parsed;
            return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : 0L;
        }

        internal BatchRetryResult RetryQueueItems(IEnumerable<string> queueKeys, int maxItems)
        {
            lock (operationGate)
            {
                var result = new BatchRetryResult();
                if (!IsReady || queueKeys == null) return result;
                int cap = Math.Max(1, Math.Min(maxItems, 50));
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (string key in queueKeys)
                {
                    if (result.Considered >= cap) { result.LimitReached = true; break; }
                    if (string.IsNullOrWhiteSpace(key) || !seen.Add(key)) continue;
                    result.Considered += 1;
                    string state = ScalarText("SELECT state FROM sync_queue WHERE queue_key=" + Sql(key) + " LIMIT 1;");
                    if (string.IsNullOrEmpty(state)) { result.Missing += 1; continue; }
                    if (state == "completed") { result.SkippedCompleted += 1; continue; }
                    if (RetryQueueItem(key)) result.Retried += 1;
                }
                return result;
            }
        }

        internal QueueStats GetQueueStats()
        {
            lock (operationGate)
            {
                var stats = new QueueStats();
                if (!IsReady) return stats;
                SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
                {
                    if (count < 8) return 0;
                    stats.Pending = ParseInt(ValueAt(values, 0));
                    stats.Retry = ParseInt(ValueAt(values, 1));
                    stats.Ready = ParseInt(ValueAt(values, 2));
                    stats.Completed = ParseInt(ValueAt(values, 3));
                    stats.PendingBytes = ParseLong(ValueAt(values, 4));
                    stats.RetryBytes = ParseLong(ValueAt(values, 5));
                    stats.ReadyBytes = ParseLong(ValueAt(values, 6));
                    stats.CompletedBytes = ParseLong(ValueAt(values, 7));
                    return 0;
                };
                Exec("SELECT " +
                    "SUM(CASE WHEN q.state='pending' THEN 1 ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='retry' THEN 1 ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='ready_for_app_sync' THEN 1 ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='completed' THEN 1 ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='pending' THEN COALESCE(f.size_bytes,0) ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='retry' THEN COALESCE(f.size_bytes,0) ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='ready_for_app_sync' THEN COALESCE(f.size_bytes,0) ELSE 0 END)," +
                    "SUM(CASE WHEN q.state='completed' THEN COALESCE(f.size_bytes,0) ELSE 0 END) " +
                    "FROM sync_queue q LEFT JOIN workspace_files f ON f.relative_path=q.relative_path;", callback);
                return stats;
            }
        }

        internal RetentionMaintenanceResult RunRetentionMaintenance()
        {
            lock (operationGate)
            {
                var result = new RetentionMaintenanceResult();
                if (!IsReady) return result;
                string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                string historyCutoff = DateTime.UtcNow.AddDays(-90).ToString("o", CultureInfo.InvariantCulture);
                string completedCutoff = DateTime.UtcNow.AddDays(-30).ToString("o", CultureInfo.InvariantCulture);
                result.HistoryBefore = CountHistory();
                result.CompletedBefore = CountQueueCompleted();
                Exec("DELETE FROM sync_history WHERE occurred_utc<" + Sql(historyCutoff) + ";");
                Exec("DELETE FROM sync_history WHERE id NOT IN (SELECT id FROM sync_history ORDER BY occurred_utc DESC,id DESC LIMIT 5000);");
                Exec("DELETE FROM sync_queue WHERE state='completed' AND updated_utc<" + Sql(completedCutoff) + ";");
                result.HistoryAfter = CountHistory();
                result.CompletedAfter = CountQueueCompleted();
                SetMeta("last_retention_utc", now);
                return result;
            }
        }

        internal RetentionMaintenanceResult RunRetentionMaintenanceIfDue()
        {
            lock (operationGate)
            {
                if (!IsReady) return new RetentionMaintenanceResult();
                DateTime last;
                string raw = ScalarText("SELECT value FROM desktop_meta WHERE key='last_retention_utc' LIMIT 1;");
                if (DateTime.TryParse(raw, null, DateTimeStyles.RoundtripKind, out last) && DateTime.UtcNow - last.ToUniversalTime() < TimeSpan.FromHours(24))
                    return new RetentionMaintenanceResult { SkippedAsNotDue = true };
                return RunRetentionMaintenance();
            }
        }

        private static string NormalizeQueueStateFilter(string value)
        {
            if (value == "pending" || value == "retry" || value == "ready_for_app_sync" || value == "completed") return value;
            return "";
        }

        private static List<string> EnumerateFilesSafe(string root, out bool complete)
        {
            complete = true;
            var filesFound = new List<string>();
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                string[] files;
                try { files = Directory.GetFiles(current); }
                catch (UnauthorizedAccessException) { complete = false; continue; }
                catch (DirectoryNotFoundException) { complete = false; continue; }
                catch (IOException) { complete = false; continue; }
                filesFound.AddRange(files);

                string[] directories;
                try { directories = Directory.GetDirectories(current); }
                catch (UnauthorizedAccessException) { complete = false; continue; }
                catch (DirectoryNotFoundException) { complete = false; continue; }
                catch (IOException) { complete = false; continue; }
                foreach (string directory in directories)
                {
                    try
                    {
                        var attributes = File.GetAttributes(directory);
                        if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                        pending.Push(directory);
                    }
                    catch (UnauthorizedAccessException) { complete = false; }
                    catch (DirectoryNotFoundException) { complete = false; }
                    catch (IOException) { complete = false; }
                }
            }
            return filesFound;
        }

        internal int CountIndexedFiles()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM workspace_files;") : 0;
        }

            }

        internal int CountQueueReady()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_queue WHERE state='ready_for_app_sync';") : 0;
        }

            }

        internal int CountQueuePending()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_queue WHERE state IN ('pending','retry');") : 0;
        }

            }

        internal string GetLastIndexUtc()
        {
            lock (operationGate)
            {
            return IsReady ? ScalarText("SELECT value FROM desktop_meta WHERE key='last_index_utc' LIMIT 1;") : "";
        }

            }

        private void EnsureSyncQueueBridgeNonceColumn()
        {
            bool exists = false;
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count > 1 && string.Equals(ValueAt(values, 1), "bridge_nonce", StringComparison.OrdinalIgnoreCase)) exists = true;
                return 0;
            };
            Exec("PRAGMA table_info(sync_queue);", callback);
            if (!exists) Exec("ALTER TABLE sync_queue ADD COLUMN bridge_nonce TEXT;");
        }

        private void SetMeta(string key, string value)
        {
            string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            Exec("INSERT OR REPLACE INTO desktop_meta(key,value,updated_utc) VALUES(" + Sql(key) + "," + Sql(value) + "," + Sql(now) + ");");
        }

        private int ScalarInt(string sql)
        {
            int value = 0;
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count > 0)
                {
                    IntPtr p = Marshal.ReadIntPtr(values, 0);
                    string text = p == IntPtr.Zero ? "0" : Marshal.PtrToStringAnsi(p);
                    int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
                }
                return 0;
            };
            Exec(sql, callback);
            return value;
        }

        private string ScalarText(string sql)
        {
            string value = "";
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count > 0)
                {
                    IntPtr p = Marshal.ReadIntPtr(values, 0);
                    value = p == IntPtr.Zero ? "" : PtrToStringUtf8(p);
                }
                return 0;
            };
            Exec(sql, callback);
            return value;
        }

        private void Exec(string sql)
        {
            Exec(sql, null);
        }

        private void Exec(string sql, SqliteCallback callback)
        {
            lock (gate)
            {
                if (db == IntPtr.Zero) throw new ObjectDisposedException("DesktopLocalStore");
                using (var utf8 = new Utf8String(sql))
                {
                    IntPtr error;
                    int code = sqlite3_exec(db, utf8.Pointer, callback, IntPtr.Zero, out error);
                    if (code != SQLITE_OK)
                    {
                        string message = error == IntPtr.Zero ? "SQLite error " + code : PtrToStringUtf8(error);
                        if (error != IntPtr.Zero) sqlite3_free(error);
                        throw new InvalidOperationException(message);
                    }
                }
            }
        }

        private static string Sql(string value)
        {
            if (value == null) return "NULL";
            return "'" + value.Replace("'", "''") + "'";
        }

        private static string MakeRelativePath(string root, string fullPath)
        {
            Uri rootUri = new Uri(AppendDirectorySeparator(Path.GetFullPath(root)));
            Uri fileUri = new Uri(Path.GetFullPath(fullPath));
            return Uri.UnescapeDataString(rootUri.MakeRelativeUri(fileUri).ToString()).Replace('/', Path.DirectorySeparatorChar);
        }

        private static string AppendDirectorySeparator(string path)
        {
            return path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal) ? path : path + Path.DirectorySeparatorChar;
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        private static string PtrToStringUtf8(IntPtr pointer)
        {
            if (pointer == IntPtr.Zero) return "";
            int length = 0;
            while (Marshal.ReadByte(pointer, length) != 0) length++;
            byte[] buffer = new byte[length];
            Marshal.Copy(pointer, buffer, 0, length);
            return Encoding.UTF8.GetString(buffer);
        }

        public void Dispose()
        {
            lock (operationGate)
            {
                lock (gate)
                {
                    if (db != IntPtr.Zero)
                    {
                        sqlite3_close_v2(db);
                        db = IntPtr.Zero;
                    }
                }
            }
        }

        private sealed class Utf8String : IDisposable
        {
            internal IntPtr Pointer { get; private set; }
            internal Utf8String(string text)
            {
                byte[] bytes = Encoding.UTF8.GetBytes((text ?? "") + "\0");
                Pointer = Marshal.AllocHGlobal(bytes.Length);
                Marshal.Copy(bytes, 0, Pointer, bytes.Length);
            }
            public void Dispose()
            {
                if (Pointer != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(Pointer);
                    Pointer = IntPtr.Zero;
                }
            }
        }
    }

    internal sealed class SyncQueueRow
    {
        internal string QueueKey;
        internal string RelativePath;
        internal string State;
        internal int Attempts;
        internal string NextAttemptUtc;
        internal string UpdatedUtc;
        internal string LastError;
        internal string Sha256;
        internal long SizeBytes;
    }

    internal sealed class SyncHistoryRow
    {
        internal string QueueKey;
        internal string RelativePath;
        internal string Event;
        internal string Detail;
        internal string OccurredUtc;
    }

    internal sealed class BatchRetryResult
    {
        internal int Considered;
        internal int Retried;
        internal int SkippedCompleted;
        internal int Missing;
        internal bool LimitReached;
    }

    internal sealed class QueueStats
    {
        internal int Pending;
        internal int Retry;
        internal int Ready;
        internal int Completed;
        internal long PendingBytes;
        internal long RetryBytes;
        internal long ReadyBytes;
        internal long CompletedBytes;
        internal int Total { get { return Pending + Retry + Ready + Completed; } }
        internal long TotalBytes { get { return PendingBytes + RetryBytes + ReadyBytes + CompletedBytes; } }
    }

    internal sealed class RetentionMaintenanceResult
    {
        internal int HistoryBefore;
        internal int HistoryAfter;
        internal int CompletedBefore;
        internal int CompletedAfter;
        internal bool SkippedAsNotDue;
    }

    internal sealed class DesktopBridgeItem
    {
        internal string QueueKey;
        internal string RelativePath;
        internal string SourceSha256;
        internal string AttemptToken;
        internal string ExpectedPhotoId;
        internal string ProjectId;
        internal string EntityType;
        internal string EntityId;
        internal string Category;
        internal string FileName;
        internal string MimeType;
        internal string AckName;
    }

    internal sealed class WorkspaceIndexResult
    {
        internal int IndexedFiles;
        internal int RemovedFiles;
        internal int EnqueuedFiles;
        internal bool ScanIncomplete;
        internal long TotalBytes;
    }

    internal sealed class BackgroundQueueResult
    {
        internal bool Processed;
        internal string RelativePath;
        internal string HashSha256;
        internal string Error;
    }
}
