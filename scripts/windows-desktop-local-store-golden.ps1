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
            string manifestPath = Path.Combine(workspace, "DesktopBridge", "ready.json");
            Assert(File.Exists(manifestPath), "Desktop bridge manifest is materialized");
            string manifest = File.ReadAllText(manifestPath, Encoding.UTF8);
            Assert(manifest.Contains("hnl-qltc-desktop-sync-v1"), "Desktop bridge manifest schema is explicit");
            Assert(manifest.Contains("proj-golden") && manifest.Contains("defect-001") && manifest.Contains("defect_before"), "canonical photo staging metadata is exported to Web bridge");
            Assert(!manifest.Contains("stage.bin"), "generic Imports queue item is not silently exposed as a photo bridge item");
            Match ackMatch = Regex.Match(manifest, "\"ackName\":\"([^\"]+)\"");
            Assert(ackMatch.Success, "bridge manifest contains deterministic ACK name");
            string ackDir = Path.Combine(workspace, "DesktopBridge", "acks");
            Directory.CreateDirectory(ackDir);
            File.WriteAllText(Path.Combine(ackDir, ackMatch.Groups[1].Value), "cloud-verified", Encoding.UTF8);
            store.RefreshBridgeManifest(workspace);
            Assert(store.CountQueueReady() == 1, "cloud-verified ACK completes only the matching photo queue item");
            string manifestAfterAck = File.ReadAllText(manifestPath, Encoding.UTF8);
            Assert(!manifestAfterAck.Contains("defect-001"), "ACKed photo is removed from ready bridge manifest");
        }

        using (DesktopLocalStore reopened = DesktopLocalStore.TryOpen(dbPath))
        {
            Assert(reopened.IsReady, "SQLite database reopens after restart");
            Assert(reopened.CountIndexedFiles() == 2, "workspace mirror persists across restart");
            Assert(reopened.CountQueueReady() == 1, "remaining sync queue state persists across restart after photo ACK");
            File.AppendAllText(photo, " changed", Encoding.UTF8);
            WorkspaceIndexResult changed = reopened.RefreshIndex(workspace);
            Assert(changed.EnqueuedFiles == 1, "changed photo is re-queued without duplicating unrelated items");
            Assert(reopened.CountQueuePending() == 1, "retryable work remains in durable SQLite queue");
            reopened.ProcessOneQueueItem(workspace);
            Assert(reopened.CountQueuePending() == 0, "changed photo is re-hashed successfully");
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
