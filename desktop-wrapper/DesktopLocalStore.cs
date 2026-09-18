using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

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
        private IntPtr db;

        internal string DatabasePath { get; private set; }
        internal bool IsReady { get { return db != IntPtr.Zero; } }
        internal string LastError { get; private set; }

        internal static DesktopLocalStore TryOpen(string databasePath)
        {
            var store = new DesktopLocalStore();
            store.DatabasePath = databasePath;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(databasePath));
                store.Open();
                store.EnsureSchema();
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
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_state ON sync_queue(state, next_attempt_utc);
");
            SetMeta("schema_version", "1");
            SetMeta("cloud_authority", "Firestore business data + Cloudflare R2 binary; SQLite is local mirror/cache only");
        }

        internal WorkspaceIndexResult RefreshIndex(string workspaceRoot)
        {
            if (!IsReady) throw new InvalidOperationException("SQLite local workspace chưa sẵn sàng.");
            var result = new WorkspaceIndexResult();
            string scanToken = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
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
                foreach (var root in roots)
                {
                    Directory.CreateDirectory(root.Value);
                    foreach (string filePath in Directory.EnumerateFiles(root.Value, "*", SearchOption.AllDirectories))
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
                }

                result.RemovedFiles = ScalarInt("SELECT COUNT(*) FROM workspace_files WHERE scan_token<>" + Sql(scanToken) + ";");
                Exec("DELETE FROM workspace_files WHERE scan_token<>" + Sql(scanToken) + ";");
                Exec("DELETE FROM sync_queue WHERE relative_path NOT IN (SELECT relative_path FROM workspace_files) AND state<>'completed';");
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
                Exec("UPDATE workspace_files SET sha256=" + Sql(hash) + ", indexed_utc=" + Sql(now) + " WHERE relative_path=" + Sql(relative) + ";");
                Exec("UPDATE sync_queue SET state='ready_for_app_sync', updated_utc=" + Sql(now) + ", last_error=NULL WHERE queue_key=" + Sql(key) + ";");
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
                result.Error = ex.Message;
            }
            return result;
        }

        internal void RefreshBridgeManifest(string workspaceRoot)
        {
            if (!IsReady) return;
            string bridgeRoot = Path.Combine(workspaceRoot, "DesktopBridge");
            string ackRoot = Path.Combine(bridgeRoot, "acks");
            Directory.CreateDirectory(bridgeRoot);
            Directory.CreateDirectory(ackRoot);

            var rows = new List<DesktopBridgeItem>();
            SqliteCallback callback = delegate(IntPtr _, int count, IntPtr values, IntPtr names)
            {
                if (count < 3) return 0;
                string key = PtrToStringUtf8(Marshal.ReadIntPtr(values, 0));
                string relative = PtrToStringUtf8(Marshal.ReadIntPtr(values, IntPtr.Size));
                string sha = PtrToStringUtf8(Marshal.ReadIntPtr(values, IntPtr.Size * 2));
                DesktopBridgeItem parsed;
                if (TryParseBridgePhotoItem(key, relative, sha, out parsed)) rows.Add(parsed);
                return 0;
            };
            Exec("SELECT q.queue_key,q.relative_path,COALESCE(f.sha256,'') FROM sync_queue q JOIN workspace_files f ON f.relative_path=q.relative_path WHERE q.state='ready_for_app_sync' ORDER BY q.created_utc;", callback);

            foreach (var row in rows)
            {
                string ackPath = Path.Combine(ackRoot, row.AckName);
                if (!File.Exists(ackPath)) continue;
                Exec("UPDATE sync_queue SET state='completed', updated_utc=" + Sql(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)) + ", last_error=NULL WHERE queue_key=" + Sql(row.QueueKey) + ";");
                try { File.Delete(ackPath); } catch { }
            }

            rows.Clear();
            Exec("SELECT q.queue_key,q.relative_path,COALESCE(f.sha256,'') FROM sync_queue q JOIN workspace_files f ON f.relative_path=q.relative_path WHERE q.state='ready_for_app_sync' ORDER BY q.created_utc;", callback);
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

        private static bool TryParseBridgePhotoItem(string queueKey, string relativePath, string sha256, out DesktopBridgeItem item)
        {
            item = null;
            if (string.IsNullOrWhiteSpace(sha256) || sha256.Length != 64) return false;
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
                ProjectId = parts[1],
                EntityType = entityType,
                EntityId = parts[3],
                Category = category,
                FileName = fileName,
                MimeType = mime,
            };
            item.AckName = item.SourceSha256 + "-" + ComputeStringSha256(queueKey).Substring(0, 16) + ".ack";
            return true;
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

        internal int CountIndexedFiles()
        {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM workspace_files;") : 0;
        }

        internal int CountQueueReady()
        {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_queue WHERE state='ready_for_app_sync';") : 0;
        }

        internal int CountQueuePending()
        {
            return IsReady ? ScalarInt("SELECT COUNT(*) FROM sync_queue WHERE state IN ('pending','retry');") : 0;
        }

        internal string GetLastIndexUtc()
        {
            return IsReady ? ScalarText("SELECT value FROM desktop_meta WHERE key='last_index_utc' LIMIT 1;") : "";
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
            lock (gate)
            {
                if (db != IntPtr.Zero)
                {
                    sqlite3_close_v2(db);
                    db = IntPtr.Zero;
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

    internal sealed class DesktopBridgeItem
    {
        internal string QueueKey;
        internal string RelativePath;
        internal string SourceSha256;
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
