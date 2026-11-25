using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace EnvisDashboard
{
    /// <summary>
    /// Removes an installed copy: shortcuts, Apps &amp; Features entry, the saved
    /// project location, and finally the install folder itself (handed to a
    /// short-lived cmd script, because a running exe cannot delete itself).
    /// </summary>
    internal static class Uninstaller
    {
        private const string AppName = "ENVIS Dashboard";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ENVIS Dashboard";

        public static void Run(bool silent)
        {
            var installDirectory = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            var executable = Application.ExecutablePath;

            if (!silent)
            {
                var confirm = MessageBox.Show(
                    "Remove " + AppName + " from this PC?\n\n" +
                    "The dashboard project, its services and your data stay untouched.",
                    AppName + " Setup",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (confirm != DialogResult.Yes) return;
            }

            var stopServices = true;
            var removeWebViewData = false;
            if (!silent)
            {
                stopServices = MessageBox.Show(
                    "Stop the dashboard services too?\n\n" +
                    "Yes  - stop the web server, API and planning watcher.\n" +
                    "No   - leave them running for colleagues on the LAN.",
                    "Stop services",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question) == DialogResult.Yes;

                removeWebViewData = MessageBox.Show(
                    "Also delete saved window data?\n\n" +
                    "This removes the remembered sign-in and the WebView2 cache in " +
                    "%LOCALAPPDATA%\\" + AppName + ".",
                    "Saved data",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) == DialogResult.Yes;
            }

            try
            {
                CloseOtherInstances();
            }
            catch
            {
                // Best effort.
            }

            if (stopServices)
            {
                try
                {
                    Task.Run(() => new ServiceHost().StopAsync()).Wait(TimeSpan.FromSeconds(45));
                }
                catch
                {
                    // Best effort: uninstalling must not fail because a port is busy.
                }
            }

            RemoveShortcuts(installDirectory);
            RemoveRegistryEntry();

            DeleteFile(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppName,
                "config.json"));
            DeleteFile(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                AppName,
                "start-services.cmd"));

            if (removeWebViewData)
            {
                DeleteDirectory(Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    AppName));
            }

            ScheduleDirectoryRemoval(installDirectory, executable);

            if (!silent)
            {
                MessageBox.Show(
                    AppName + " has been removed.\n\nThe project folder and the dashboard data were not changed.",
                    AppName + " Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }

        private static void CloseOtherInstances()
        {
            var current = Process.GetCurrentProcess();
            foreach (var name in new[] { "ENVIS Dashboard", "ENVISDashboard" })
            {
                foreach (var process in Process.GetProcessesByName(name))
                {
                    if (process.Id == current.Id) continue;
                    try
                    {
                        process.Kill(true);
                        process.WaitForExit(5000);
                    }
                    catch
                    {
                        // Already gone.
                    }
                }
            }
        }

        private static void RemoveShortcuts(string installDirectory)
        {
            var startMenu = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                AppName + ".lnk");
            var desktop = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                AppName + ".lnk");
            var commonStartMenu = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                AppName + ".lnk");

            DeleteFile(startMenu);
            DeleteFile(desktop);
            DeleteFile(commonStartMenu);

            // A Start Menu folder named after the app, if one was ever created.
            DeleteDirectory(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                AppName));
        }

        private static void RemoveRegistryEntry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            }
            catch
            {
                // Not present.
            }

            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\ENVIS Dashboard", false);
            }
            catch
            {
                // Not present.
            }
        }

        /// <summary>
        /// Writes a tiny cmd script to %TEMP% that waits for this process to exit,
        /// then deletes the install folder. Windows cannot delete a running exe.
        /// </summary>
        private static void ScheduleDirectoryRemoval(string installDirectory, string executable)
        {
            try
            {
                var scriptPath = Path.Combine(Path.GetTempPath(), "envis-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
                var exeName = Path.GetFileName(executable);

                var script = string.Join(
                    Environment.NewLine,
                    "@echo off",
                    "setlocal",
                    ":wait",
                    "tasklist /fi \"imagename eq " + exeName + "\" /nh 2>nul | find /i \"" + exeName + "\" >nul && (",
                    "  timeout /t 1 /nobreak >nul",
                    "  goto wait",
                    ")",
                    "rd /s /q \"" + installDirectory + "\" >nul 2>&1",
                    "del /f /q \"%~f0\" >nul 2>&1",
                    string.Empty);

                File.WriteAllText(scriptPath, script, Encoding.Default);

                var info = new ProcessStartInfo("cmd.exe")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                info.ArgumentList.Add("/d");
                info.ArgumentList.Add("/c");
                info.ArgumentList.Add(scriptPath);
                Process.Start(info);
            }
            catch
            {
                // Worst case the folder stays behind; everything else is removed.
            }
        }

        private static void DeleteFile(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // Locked or already gone.
            }
        }

        private static void DeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, true);
            }
            catch
            {
                // Locked or already gone.
            }
        }
    }
}
