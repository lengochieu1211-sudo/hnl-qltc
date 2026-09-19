$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'C# compiler csc.exe not found for DesktopLocalStore golden.' }

$tempRoot = Join-Path $env:RUNNER_TEMP ("hnl-desktop-local-store-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$harness = Join-Path $tempRoot 'DesktopLocalStoreGolden.cs'
$exe = Join-Path $tempRoot 'DesktopLocalStoreGolden.exe'
$db = Join-Path $tempRoot 'workspace.db'
$workspace = Join-Path $tempRoot 'workspace'

@"
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Threading;
using QLTCAnPhu;

internal static class DesktopLocalStoreGolden
{
    private static void Assert(bool ok, string message)
    {
        if (!ok) throw new Exception("DESKTOP LOCAL STORE FAIL: " + message);
        Console.WriteLine("PASS LOCAL STORE: " + message);
    }

    public static int Main(string[] args)
    {
        string dbPath = args[0];
        string workspace = args[1];
        Directory.CreateDirectory(Path.Combine(workspace, "Imports"));
        Directory.CreateDirectory(Path.Combine(workspace, "Photos", "proj-golden", "defect", "defect-001", "defect_before"));
        Directory.CreateDirectory(Path.Combine(workspace, "Backup"));
        Directory.CreateDirectory(Path.Combine(workspace, "Exports"));
        Directory.CreateDirectory(Path.Combine(workspace, "Reports"));
        Directory.CreateDirectory(Path.Combine(workspace, "Diagnostics"));

        string photo = Path.Combine(workspace, "Photos", "proj-golden", "defect", "defect-001", "defect_before", "ảnh-thử-nghiệm.jpg");
        string import = Path.Combine(workspace, "Imports", "stage.bin");
        File.WriteAllText(photo, "HNL QLTC SQLite UTF-8", Encoding.UTF8);
        File.WriteAllBytes(import, new byte[] { 1, 2, 3, 4, 5 });

        using (DesktopLocalStore store = DesktopLocalStore.TryOpen(dbPath))
        {
            Assert(store.IsReady, "winsqlite3 opens the local workspace database");
            WorkspaceIndexResult first = store.RefreshIndex(workspace);
            Assert(first.IndexedFiles == 2, "workspace index detects two staging files");
            Assert(first.EnqueuedFiles == 2, "Imports/Photos changes are queued locally");
            Assert(store.CountQueuePending() == 2, "two local preparation jobs are pending");
            store.ProcessOneQueueItem(workspace);
            store.ProcessOneQueueItem(workspace);
            Assert(store.CountQueuePending() == 0, "background queue drains pending preparation jobs");
            Assert(store.CountQueueReady() == 2, "prepared files persist as ready_for_app_sync");
            Assert(store.CountHistory() == 2, "prepared queue transitions are recorded in sync history");
            string manifestPath = Path.Combine(workspace, "DesktopBridge", "ready.json");
            Assert(File.Exists(manifestPath), "Desktop bridge manifest is materialized");
            string manifest = File.ReadAllText(manifestPath, Encoding.UTF8);
            Assert(manifest.Contains("hnl-qltc-desktop-sync-v1"), "Desktop bridge manifest schema is explicit");
            Assert(manifest.Contains("proj-golden") && manifest.Contains("defect-001") && manifest.Contains("defect_before"), "canonical photo staging metadata is exported to Web bridge");
            Assert(!manifest.Contains("stage.bin"), "generic Imports queue item is not silently exposed as a photo bridge item");
            Match ackMatch = Regex.Match(manifest, "\"ackName\":\"([^\"]+)\"");
            Match queueKeyMatch = Regex.Match(manifest, "\"queueKey\":\"([^\"]+)\"");
            Match sourceShaMatch = Regex.Match(manifest, "\"sourceSha256\":\"([^\"]+)\"");
            Match attemptTokenMatch = Regex.Match(manifest, "\"attemptToken\":\"([^\"]+)\"");
            Match photoIdMatch = Regex.Match(manifest, "\"photoId\":\"([^\"]+)\"");
            Assert(ackMatch.Success && queueKeyMatch.Success && sourceShaMatch.Success && attemptTokenMatch.Success && photoIdMatch.Success, "bridge manifest contains ACK identity, one-time attempt token and deterministic photo ID");
            string ackDir = Path.Combine(workspace, "DesktopBridge", "acks");
            Directory.CreateDirectory(ackDir);
            string ackPath = Path.Combine(ackDir, ackMatch.Groups[1].Value);
            File.WriteAllText(ackPath, "{\"schema\":\"hnl-qltc-desktop-sync-ack-v1\",\"queueKey\":\"wrong\",\"sourceSha256\":\"" + sourceShaMatch.Groups[1].Value + "\",\"attemptToken\":\"" + attemptTokenMatch.Groups[1].Value + "\",\"projectId\":\"proj-golden\",\"photoId\":\"" + photoIdMatch.Groups[1].Value + "\",\"cloudVerified\":true}", Encoding.UTF8);
            store.RefreshBridgeManifest(workspace);
            Assert(store.CountQueueReady() == 2 && store.CountQueueCompleted() == 0, "invalid ACK payload is rejected fail-closed");
            File.WriteAllText(ackPath, "{\"schema\":\"hnl-qltc-desktop-sync-ack-v1\",\"queueKey\":\"" + queueKeyMatch.Groups[1].Value + "\",\"sourceSha256\":\"" + sourceShaMatch.Groups[1].Value + "\",\"attemptToken\":\"00000000000000000000000000000000\",\"projectId\":\"proj-golden\",\"photoId\":\"" + photoIdMatch.Groups[1].Value + "\",\"cloudVerified\":true}", Encoding.UTF8);
            store.RefreshBridgeManifest(workspace);
            Assert(store.CountQueueReady() == 2 && store.CountQueueCompleted() == 0, "stale/replayed ACK with wrong attempt token is rejected");
            File.WriteAllText(ackPath, "{\"schema\":\"hnl-qltc-desktop-sync-ack-v1\",\"queueKey\":\"" + queueKeyMatch.Groups[1].Value + "\",\"sourceSha256\":\"" + sourceShaMatch.Groups[1].Value + "\",\"attemptToken\":\"" + attemptTokenMatch.Groups[1].Value + "\",\"projectId\":\"proj-golden\",\"photoId\":\"" + photoIdMatch.Groups[1].Value + "\",\"cloudVerified\":true}", Encoding.UTF8);
            store.RefreshBridgeManifest(workspace);
            Assert(store.CountQueueReady() == 1, "validated Cloud ACK completes only the matching photo queue item");
            Assert(store.CountQueueCompleted() == 1, "ACKed photo is retained as completed audit state");
            Assert(store.CountHistory() == 3, "cloud verification is appended to sync history");
            string manifestAfterAck = File.ReadAllText(manifestPath, Encoding.UTF8);
            Assert(!manifestAfterAck.Contains("defect-001"), "ACKed photo is removed from ready bridge manifest");
        }

        using (DesktopLocalStore reopened = DesktopLocalStore.TryOpen(dbPath))
        {
            Assert(reopened.IsReady, "SQLite database reopens after restart");
            Assert(reopened.CountIndexedFiles() == 2, "workspace mirror persists across restart");
            Assert(reopened.CountQueueReady() == 1, "remaining sync queue state persists across restart after photo ACK");
            File.AppendAllText(photo, " changed", Encoding.UTF8);
            string batchA = Path.Combine(workspace, "Imports", "batch-a.bin");
            string batchB = Path.Combine(workspace, "Imports", "batch-b.bin");
            File.WriteAllBytes(batchA, new byte[] { 10, 11, 12 });
            File.WriteAllBytes(batchB, new byte[] { 20, 21, 22, 23 });
            WorkspaceIndexResult changed = reopened.RefreshIndex(workspace);
            Assert(changed.EnqueuedFiles == 3, "changed photo plus two batch files are queued without duplicating unrelated items");
            Assert(reopened.CountQueuePending() == 3, "retryable batch work remains in durable SQLite queue");
            List<SyncQueueRow> batchRows = reopened.GetQueueRows(20, "pending", "batch-");
            Assert(batchRows.Count == 2, "Sync Center state/search filter returns the two matching batch rows");
            var batchKeys = new List<string>();
            foreach (SyncQueueRow row in batchRows) batchKeys.Add(row.QueueKey);
            BatchRetryResult batchRetry = reopened.RetryQueueItems(batchKeys, 50);
            Assert(batchRetry.Retried == 2 && !batchRetry.LimitReached, "batch Retry safely resets selected non-completed items");
            Assert(reopened.GetHistoryRows(50).Count >= 5, "batch Retry is auditable in sync history");
            QueueStats stats = reopened.GetQueueStats();
            Assert(stats.Pending == 3 && stats.Total >= 4 && stats.TotalBytes > 0, "Sync Center statistics expose queue state counts and byte totals");
            reopened.ProcessOneQueueItem(workspace);
            reopened.ProcessOneQueueItem(workspace);
            reopened.ProcessOneQueueItem(workspace);
            Assert(reopened.CountQueuePending() == 0, "changed photo and batch files are re-hashed successfully");
            string replayManifest = File.ReadAllText(Path.Combine(workspace, "DesktopBridge", "ready.json"), Encoding.UTF8);
            Assert(!replayManifest.Contains("\"attemptToken\":\"" + attemptTokenMatch.Groups[1].Value + "\""), "re-prepared photo receives a fresh attempt token so prior ACK cannot replay");
            RetentionMaintenanceResult retention = reopened.RunRetentionMaintenanceIfDue();
            Assert(retention.SkippedAsNotDue, "retention maintenance is throttled to at most once per 24 hours");

            Exception concurrencyError = null;
            Thread[] workers = new Thread[3];
            workers[0] = new Thread(delegate() { try { for (int i = 0; i < 4; i++) reopened.RefreshIndex(workspace); } catch (Exception ex) { concurrencyError = ex; } });
            workers[1] = new Thread(delegate() { try { for (int i = 0; i < 12; i++) reopened.GetQueueRows(100, "", ""); } catch (Exception ex) { concurrencyError = ex; } });
            workers[2] = new Thread(delegate() { try { for (int i = 0; i < 8; i++) reopened.RefreshBridgeManifest(workspace); } catch (Exception ex) { concurrencyError = ex; } });
            foreach (Thread worker in workers) worker.Start();
            foreach (Thread worker in workers) worker.Join();
            Assert(concurrencyError == null, "operation-level gate serializes index, bridge and Sync Center reads without transaction interleaving");

            File.Delete(import);
            WorkspaceIndexResult removed = reopened.RefreshIndex(workspace);
            Assert(removed.RemovedFiles == 1, "removed workspace file is removed from local mirror");
        }

        Assert(File.Exists(dbPath) && new FileInfo(dbPath).Length > 0, "SQLite workspace.db is materialized on disk");
        Console.WriteLine("WINDOWS DESKTOP LOCAL STORE GOLDEN PASS");
        return 0;
    }
}
"@ | Set-Content -LiteralPath $harness -Encoding UTF8

try {
  & $csc /nologo /target:exe /optimize+ /reference:System.dll /out:"$exe" (Join-Path $root 'desktop-wrapper\DesktopLocalStore.cs') $harness
  if ($LASTEXITCODE -ne 0) { throw "DesktopLocalStore golden compile failed: $LASTEXITCODE" }
  & $exe $db $workspace
  if ($LASTEXITCODE -ne 0) { throw "DesktopLocalStore golden failed: $LASTEXITCODE" }
} finally {
  Remove-Item -LiteralPath $tempRoot -Force -Recurse -ErrorAction SilentlyContinue
}
