using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace QLTCAnPhu
{
    internal static class Program
    {
        private const string AppBaseUrl = "https://hnlqltc.web.app/?app=desktop";
        private const string ProductName = "HNL Quản Lý Thi Công";

        [STAThread]
        private static void Main()
        {
            try
            {
                var releaseTag = string.IsNullOrWhiteSpace(BuildInfo.ReleaseTag)
                    ? GetAssemblyVersion()
                    : BuildInfo.ReleaseTag;
                var appUrl = AppBaseUrl + "&v=" + Uri.EscapeDataString(releaseTag);

                BrowserInfo browser = FindBrowser();
                if (browser == null)
                {
                    OpenDefaultBrowser(appUrl);
                    return;
                }

                var baseProfileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "QLTCAnPhu"
                );

                // Keep the legacy Edge profile path unchanged so existing offline/local data is preserved.
                var profileDir = Path.Combine(baseProfileDir, browser.ProfileFolder);
                Directory.CreateDirectory(profileDir);

                var args =
                    "--app=\"" + appUrl + "\"" +
                    " --user-data-dir=\"" + profileDir + "\"" +
                    " --no-first-run" +
                    " --start-maximized";

                Process.Start(new ProcessStartInfo
                {
                    FileName = browser.ExecutablePath,
                    Arguments = args,
                    UseShellExecute = false,
                    WorkingDirectory = Path.GetDirectoryName(browser.ExecutablePath)
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Không thể mở " + ProductName + ".\n\n" + ex.Message,
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static string GetAssemblyVersion()
        {
            var version = typeof(Program).Assembly.GetName().Version;
            return version != null ? version.ToString(3) : "0.0.0";
        }

        private static BrowserInfo FindBrowser()
        {
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            var candidates = new[]
            {
                new BrowserInfo(Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile"),
                new BrowserInfo(Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile"),
                new BrowserInfo(Path.Combine(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"), "EdgeProfile"),
                new BrowserInfo(Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile"),
                new BrowserInfo(Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile"),
                new BrowserInfo(Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"), "ChromeProfile")
            };

            foreach (var candidate in candidates)
            {
                if (!string.IsNullOrEmpty(candidate.ExecutablePath) && File.Exists(candidate.ExecutablePath))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static void OpenDefaultBrowser(string appUrl)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = appUrl,
                UseShellExecute = true
            });
        }

        private sealed class BrowserInfo
        {
            public string ExecutablePath { get; private set; }
            public string ProfileFolder { get; private set; }

            public BrowserInfo(string executablePath, string profileFolder)
            {
                ExecutablePath = executablePath;
                ProfileFolder = profileFolder;
            }
        }
    }
}
