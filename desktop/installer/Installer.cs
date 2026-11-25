using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32;

namespace EnvisSetup
{
    internal sealed class InstallProgress
    {
        public int Percent { get; set; }
        public string Message { get; set; } = string.Empty;
    }

    /// <summary>
    /// All install/uninstall work for the Setup.exe. The dashboard executable is
    /// embedded in this installer, so Setup.exe is a single distributable file.
    /// </summary>
    internal static class Installer
    {
        public const string PayloadResource = "ENVISDashboard.payload.exe";
        public const string AppName = "ENVIS Dashboard";
        public const string ProductVersion = "1.3.12";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ENVIS Dashboard";

        public static string DefaultInstallDirectory
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs",
                    AppName);
            }
        }

        public static string DataDirectory
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    AppName);
            }
        }

        public static string InstalledExecutable(string installDirectory)
        {
            return Path.Combine(installDirectory, AppName + ".exe");
        }

        public static bool IsProjectRoot(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return false;
            try
            {
                return File.Exists(Path.Combine(path, "scripts", "serve-live.mjs")) &&
                       File.Exists(Path.Combine(path, "package.json"));
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Walks up from a starting folder looking for the dashboard project.</summary>
        public static string? FindProjectRoot(string? startDirectory)
        {
            if (string.IsNullOrWhiteSpace(startDirectory)) return null;
            try
            {
                var directory = new DirectoryInfo(startDirectory);
                for (var depth = 0; depth < 8 && directory != null; depth++, directory = directory.Parent)
                {
                    if (IsProjectRoot(directory.FullName)) return directory.FullName;
                }
            }
            catch
            {
                // An unreadable path simply has no project here.
            }

            return null;
        }

        public static bool AlreadyInstalled
        {
            get
            {
                return File.Exists(InstalledExecutable(DefaultInstallDirectory)) ||
                       Registry.CurrentUser.OpenSubKey(UninstallKey) != null;
            }
        }

        public static void Install(
            string installDirectory,
            string? projectRoot,
            string? serverUrl,
            bool startMenuShortcut,
            bool desktopShortcut,
            Action<InstallProgress>? progress)
        {
            if (string.IsNullOrWhiteSpace(installDirectory))
            {
                throw new InvalidOperationException("Choose an install folder.");
            }

            installDirectory = Path.GetFullPath(installDirectory.Trim());
            if (IsProjectRoot(installDirectory))
            {
                throw new InvalidOperationException(
                    "That folder is the dashboard project itself. Choose a separate program folder, for example:\n" +
                    DefaultInstallDirectory);
            }

            var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource);
            if (payload == null)
            {
                throw new InvalidOperationException(
                    "This Setup.exe is incomplete: the dashboard program is missing from it. Download or rebuild Setup.exe.");
            }

            using (payload)
            {
                Report(progress, 4, "Preparing the program folder...");
                CloseRunningInstances();
                Directory.CreateDirectory(installDirectory);

                var target = InstalledExecutable(installDirectory);
                var temporary = target + ".new";
                DeleteQuietly(temporary);

                Report(progress, 8, "Extracting the dashboard program...");
                var total = payload.Length;
                var buffer = new byte[1024 * 256];
                long copied = 0;
                int read;
                using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    while ((read = payload.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        copied += read;
                        var percent = total == 0 ? 90 : 8 + (int)(82.0 * copied / total);
                        Report(progress, percent, "Extracting the dashboard program... " +
                                                 (copied / (1024 * 1024)) + " MB of " +
                                                 (total / (1024 * 1024)) + " MB");
                    }
                }

                DeleteQuietly(target);
                File.Move(temporary, target);

                Report(progress, 92, "Saving the dashboard project location...");
                WriteConfiguration(projectRoot, serverUrl);

                Report(progress, 95, "Creating shortcuts...");
                if (startMenuShortcut) CreateShortcut(StartMenuShortcutPath, target);
                if (desktopShortcut) CreateShortcut(DesktopShortcutPath, target);

                Report(progress, 98, "Registering the app in Apps & Features...");
                WriteRegistryEntry(installDirectory, target, projectRoot);

                Report(progress, 100, "Done.");
            }
        }

        public static int RunSilent(string installDirectory, string? projectRoot, string? serverUrl, bool startMenu, bool desktop)
        {
            try
            {
                projectRoot = ResolveProjectRoot(projectRoot);
                if (!string.IsNullOrWhiteSpace(serverUrl)) projectRoot = null;
                Install(installDirectory, projectRoot, serverUrl, startMenu, desktop, null);
                return 0;
            }
            catch (Exception error)
            {
                try
                {
                    File.AppendAllText(
                        Path.Combine(Path.GetTempPath(), "envis-setup.log"),
                        DateTime.Now + "  silent install failed: " + error + Environment.NewLine);
                }
                catch
                {
                    // Logging must not change the exit code.
                }

                return 1;
            }
        }

        public static string? ResolveProjectRoot(string? projectRoot)
        {
            if (IsProjectRoot(projectRoot)) return Path.GetFullPath(projectRoot!);
            return FindProjectRoot(AppContext.BaseDirectory);
        }

        public static string StartMenuShortcutPath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    AppName + ".lnk");
            }
        }

        public static string DesktopShortcutPath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    AppName + ".lnk");
            }
        }

        private static void WriteConfiguration(string? projectRoot, string? serverUrl)
        {
            Directory.CreateDirectory(DataDirectory);
            var configPath = Path.Combine(DataDirectory, "config.json");

            var server = NormalizeServer(serverUrl);
            if (string.IsNullOrWhiteSpace(projectRoot) && server == null)
            {
                DeleteQuietly(configPath);
                return;
            }

            var lines = new List<string>();
            if (!string.IsNullOrWhiteSpace(projectRoot))
            {
                lines.Add("  \"projectRoot\": " + JsonSerializer.Serialize(projectRoot));
            }
            if (server != null)
            {
                lines.Add("  \"serverUrl\": " + JsonSerializer.Serialize(server));
            }

            var json = "{\n" + string.Join(",\n", lines) + "\n}\n";
            File.WriteAllText(configPath, json);
        }

        private static string? NormalizeServer(string? serverUrl)
        {
            if (string.IsNullOrWhiteSpace(serverUrl)) return null;
            if (!Uri.TryCreate(serverUrl.Trim(), UriKind.Absolute, out var uri)) return null;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
            return uri.GetLeftPart(UriPartial.Authority) + uri.AbsolutePath.TrimEnd('/');
        }

        private static void WriteRegistryEntry(string installDirectory, string executable, string? projectRoot)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                if (key == null) throw new InvalidOperationException("The uninstall entry could not be written.");

                key.SetValue("DisplayName", AppName);
                key.SetValue("DisplayVersion", ProductVersion);
                key.SetValue("Publisher", "Environmental Management Bureau Region VII");
                key.SetValue("DisplayIcon", executable + ",0");
                key.SetValue("InstallLocation", installDirectory);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                key.SetValue("UninstallString", "\"" + executable + "\" --uninstall");
                key.SetValue("QuietUninstallString", "\"" + executable + "\" --uninstall --silent");
                key.SetValue("NoModify", 1);
                key.SetValue("NoRepair", 1);
                key.SetValue("EstimatedSize", (int)(new FileInfo(executable).Length / 1024), RegistryValueKind.DWord);
                if (!string.IsNullOrWhiteSpace(projectRoot)) key.SetValue("ProjectRoot", projectRoot);
            }

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\ENVIS Dashboard"))
            {
                if (key != null)
                {
                    key.SetValue("InstallLocation", installDirectory);
                    if (!string.IsNullOrWhiteSpace(projectRoot)) key.SetValue("ProjectRoot", projectRoot);
                }
            }
        }

        /// <summary>Creates a .lnk through the Windows Script Host, avoiding a COM reference.</summary>
        public static void CreateShortcut(string shortcutPath, string targetPath)
        {
            var directory = Path.GetDirectoryName(shortcutPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("Windows Script Host is not available.");

            dynamic shell = Activator.CreateInstance(shellType)!;
            try
            {
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Description = AppName + " - Region VII";
                shortcut.WindowStyle = 1;
                shortcut.Save();
            }
            finally
            {
                Marshal2.Release(shell);
            }
        }

        private static void CloseRunningInstances()
        {
            var current = Process.GetCurrentProcess();
            foreach (var name in new[] { AppName, "ENVISDashboard" })
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

        private static void Report(Action<InstallProgress>? progress, int percent, string message)
        {
            if (progress == null) return;
            progress(new InstallProgress { Percent = percent, Message = message });
        }

        private static void DeleteQuietly(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // A locked file is renamed away by the caller where it matters.
            }
        }
    }

    /// <summary>Releases late-bound COM objects without a Microsoft.CSharp reference.</summary>
    internal static class Marshal2
    {
        public static void Release(object? value)
        {
            try
            {
                if (value != null && System.Runtime.InteropServices.Marshal.IsComObject(value))
                {
                    System.Runtime.InteropServices.Marshal.ReleaseComObject(value);
                }
            }
            catch
            {
                // The runtime will clean it up.
            }
        }
    }
}
