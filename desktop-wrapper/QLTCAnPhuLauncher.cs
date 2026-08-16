using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace QLTCAnPhu
{
    internal static class Program
    {
        private const string AppUrl = "https://com-example-qlct-61329.web.app/?app=desktop&v=20260816-sort-perms";

        [STAThread]
        private static void Main()
        {
            try
            {
                var edgePath = FindEdge();
                if (string.IsNullOrEmpty(edgePath))
                {
                    Process.Start(AppUrl);
                    return;
                }

                var profileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "QLTCAnPhu",
                    "EdgeProfile"
                );
                Directory.CreateDirectory(profileDir);
                ClearWebCaches(profileDir);

                var args =
                    "--app=" + AppUrl +
                    " --user-data-dir=\"" + profileDir + "\"" +
                    " --no-first-run";

                Process.Start(new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments = args,
                    UseShellExecute = false,
                    WorkingDirectory = Path.GetDirectoryName(edgePath)
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Cannot open QLTC An Phu.\n\n" + ex.Message,
                    "QLTC An Phu",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static string FindEdge()
        {
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
            };

            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static void ClearWebCaches(string profileDir)
        {
            var cacheDirs = new[]
            {
                Path.Combine(profileDir, "Default", "Cache"),
                Path.Combine(profileDir, "Default", "Code Cache"),
                Path.Combine(profileDir, "Default", "GPUCache"),
                Path.Combine(profileDir, "Default", "Service Worker", "CacheStorage"),
                Path.Combine(profileDir, "Default", "Service Worker", "ScriptCache"),
                Path.Combine(profileDir, "Default", "Storage", "ext"),
            };

            foreach (var cacheDir in cacheDirs)
            {
                TryDeleteDirectory(cacheDir);
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch
            {
                // Edge may still be closing; cached files are safe to leave for this launch.
            }
        }
    }
}
