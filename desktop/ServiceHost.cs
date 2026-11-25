using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EnvisDashboard
{
    /// <summary>
    /// Starts, probes and stops the existing ENVIS services (Vite on 5173, the
    /// Cloudflare Worker API on 8787, the planning watcher on 8788) by running
    /// the project's own scripts/serve-live.mjs supervisor. No service logic is
    /// duplicated here, so the desktop app behaves exactly like `npm run live:lan`.
    /// </summary>
    internal sealed class ServiceHost : IDisposable
    {
        public const string BaseUrl = "http://127.0.0.1:5173";

        private static readonly HttpClient Http = new HttpClient
        {
            // Per-request timeouts are applied with a linked token below, so a
            // slow first response is a retry, not a fatal error.
            Timeout = Timeout.InfiniteTimeSpan,
        };

        private readonly object _logLock = new object();
        private Process? _supervisor;
        private bool _disposed;

        public string? ProjectRoot { get; }
        public string? NodePath { get; }
        public string SetupError { get; }

        public bool IsReady
        {
            get { return SetupError.Length == 0 && ProjectRoot != null && NodePath != null; }
        }

        public string LogFile
        {
            get
            {
                if (ProjectRoot == null) return string.Empty;
                return Path.Combine(ProjectRoot, "logs", "desktop-app.log");
            }
        }

        /// <summary>
        /// The supervisor, Vite, the API and the planning watcher write here.
        /// Kept separate from <see cref="LogFile"/> because the running services
        /// hold that file open, which would make the app's own notes fail.
        /// </summary>
        public string ServicesLogFile
        {
            get
            {
                if (ProjectRoot == null) return string.Empty;
                return Path.Combine(ProjectRoot, "logs", "services.log");
            }
        }

        public ServiceHost()
        {
            var problems = new List<string>();
            ProjectRoot = LocateProjectRoot();
            if (ProjectRoot == null)
            {
                problems.Add("Could not find the ENVIS Dashboard project folder (package.json and scripts\\serve-live.mjs). Reinstall the app and point it at the project, or set ENVIS_PROJECT_ROOT.");
            }

            NodePath = LocateNode();
            if (NodePath == null)
            {
                problems.Add("Node.js was not found. Install Node.js 20 or newer, then start the app again.");
            }

            SetupError = string.Join(" ", problems);
        }

        private static string? LocateProjectRoot()
        {
            var configured = ReadConfiguredRoot();
            if (configured != null) return configured;

            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            for (var depth = 0; depth < 8 && directory != null; depth++, directory = directory.Parent)
            {
                if (IsProjectRoot(directory.FullName)) return directory.FullName;
            }

            return null;
        }

        /// <summary>
        /// An installed copy lives outside the project, so the installer writes
        /// the project location to a small JSON config file.
        /// </summary>
        private static string? ReadConfiguredRoot()
        {
            var fromEnvironment = Environment.GetEnvironmentVariable("ENVIS_PROJECT_ROOT");
            if (IsProjectRoot(fromEnvironment)) return Path.GetFullPath(fromEnvironment!);

            var candidates = new[]
            {
                Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ENVIS Dashboard",
                    "config.json"),
                Path.Combine(AppContext.BaseDirectory, "config.json"),
            };

            foreach (var candidate in candidates)
            {
                try
                {
                    if (!File.Exists(candidate)) continue;
                    using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(candidate)))
                    {
                        System.Text.Json.JsonElement value;
                        if (document.RootElement.TryGetProperty("projectRoot", out value))
                        {
                            var path = value.GetString();
                            if (IsProjectRoot(path)) return Path.GetFullPath(path!);
                        }
                    }
                }
                catch
                {
                    // A malformed config must not stop the search.
                }
            }

            return null;
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

        private static string? LocateNode()
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (var entry in path.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                try
                {
                    var candidate = Path.Combine(entry.Trim().Trim('"'), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                    // A malformed PATH entry must not stop the search.
                }
            }

            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var candidates = new[]
            {
                Path.Combine(programFiles, "nodejs", "node.exe"),
                Path.Combine(programFilesX86, "nodejs", "node.exe"),
                Path.Combine(localAppData, "Programs", "nodejs", "node.exe"),
            };

            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }

            return null;
        }

        /// <summary>Starts the supervisor unless the dashboard is already answering.</summary>
        public bool StartSupervisor(bool force = false)
        {
            EnsureReady();

            if (!force && IsPortOpen(5173)) return false;
            if (_supervisor != null && !_supervisor.HasExited) return false;

            var logsDirectory = Path.Combine(ProjectRoot!, "logs");
            Directory.CreateDirectory(logsDirectory);

            // Run through a tiny .cmd file that redirects the supervisor's own
            // output into a log file. Piping it into this app instead would mean
            // the pipe closes when the window exits, which can kill the services
            // that LAN users still depend on.
            var launcherDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ENVIS Dashboard");
            Directory.CreateDirectory(launcherDirectory);
            var launcher = Path.Combine(launcherDirectory, "start-services.cmd");

            var script = string.Join(
                Environment.NewLine,
                "@echo off",
                "cd /d \"" + ProjectRoot + "\"",
                "set \"ENVIS_HOST=0.0.0.0\"",
                "set \"ENVIS_PORT=5173\"",
                "set \"ENVIS_API_PORT=8787\"",
                "set \"PLANNING_PORT=8788\"",
                "\"" + NodePath + "\" \"" + Path.Combine(ProjectRoot!, "scripts", "serve-live.mjs") + "\" >> \"" + ServicesLogFile + "\" 2>&1",
                string.Empty);
            File.WriteAllText(launcher, script);

            var info = new ProcessStartInfo("cmd.exe")
            {
                WorkingDirectory = ProjectRoot!,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            info.ArgumentList.Add("/d");
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add(launcher);

            var process = new Process { StartInfo = info };
            if (!process.Start())
            {
                throw new InvalidOperationException("The Node.js supervisor could not be started.");
            }

            _supervisor = process;
            AppendLog("[app] supervisor started (pid " + process.Id + ")");
            return true;
        }

        public async Task WaitUntilLiveAsync(TimeSpan timeout, Action<string>? progress, CancellationToken cancellationToken)
        {
            EnsureReady();

            var watch = Stopwatch.StartNew();
            while (watch.Elapsed < timeout)
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (await IsSiteLiveAsync(cancellationToken).ConfigureAwait(false)) return;

                if (_supervisor != null && _supervisor.HasExited)
                {
                    throw new InvalidOperationException(
                        "The service supervisor stopped (exit code " + _supervisor.ExitCode + "). " +
                        "See the log for details: " + LogFile);
                }

                if (progress != null)
                {
                    var seconds = Math.Round(watch.Elapsed.TotalSeconds);
                    progress(seconds < 8
                        ? "Starting the dashboard services..."
                        : "Still starting the dashboard services... (" + seconds + "s)");
                }

                await Task.Delay(700, cancellationToken).ConfigureAwait(false);
            }

            throw new TimeoutException(
                "The dashboard did not answer at " + BaseUrl + " within " +
                timeout.TotalSeconds.ToString("0") + " seconds. See the log: " + LogFile);
        }

        public async Task RestartAsync(Action<string>? progress, CancellationToken cancellationToken)
        {
            EnsureReady();
            if (progress != null) progress("Stopping the dashboard services...");
            await StopAsync().ConfigureAwait(false);
            await Task.Delay(900, cancellationToken).ConfigureAwait(false);

            if (progress != null) progress("Starting the dashboard services...");
            StartSupervisor(force: true);
            await WaitUntilLiveAsync(TimeSpan.FromSeconds(120), progress, cancellationToken).ConfigureAwait(false);
        }

        public async Task StopAsync()
        {
            KillSupervisors();
            await Task.Delay(500).ConfigureAwait(false);
            KillPortOwners();
            await Task.Delay(600).ConfigureAwait(false);
            KillPortOwners();
            AppendLog("[app] services stopped");
        }

        public string DescribeStatus()
        {
            var site = IsPortOpen(5173);
            var api = IsPortOpen(8787);
            var planning = IsPortOpen(8788);

            var text = new StringBuilder();
            text.AppendLine("Dashboard ...... " + (site ? "LIVE" : "DOWN") + "   " + BaseUrl);
            text.AppendLine("API ............ " + (api ? "LIVE" : "DOWN") + "   http://127.0.0.1:8787");
            text.AppendLine("Planning sync .. " + (planning ? "LIVE" : "DOWN") + "   http://127.0.0.1:8788");
            text.AppendLine();
            text.AppendLine("Project: " + (ProjectRoot ?? "(not found)"));
            text.AppendLine("Node:    " + (NodePath ?? "(not found)"));
            text.AppendLine("App log:      " + LogFile);
            text.AppendLine("Services log: " + ServicesLogFile);
            if (SetupError.Length > 0)
            {
                text.AppendLine();
                text.AppendLine("Problem: " + SetupError);
            }

            return text.ToString();
        }

        public void OpenLogsFolder()
        {
            if (ProjectRoot == null) return;
            var logs = Path.Combine(ProjectRoot, "logs");
            Directory.CreateDirectory(logs);
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + logs + "\"") { UseShellExecute = true });
        }

        private void EnsureReady()
        {
            if (!IsReady) throw new InvalidOperationException(SetupError);
        }

        private static async Task<bool> IsSiteLiveAsync(CancellationToken cancellationToken)
        {
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                try
                {
                    using (var response = await Http.GetAsync(BaseUrl, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false))
                    {
                        return response.IsSuccessStatusCode;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    // The app is shutting down: let the caller see the cancellation.
                    throw;
                }
                catch (OperationCanceledException)
                {
                    // A cold Vite start can take longer than the probe timeout.
                    // That is "not ready yet", never "the app is closing".
                    return false;
                }
                catch
                {
                    return false;
                }
            }
        }

        public static bool IsPortOpen(int port, int timeoutMilliseconds = 600)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var connect = client.ConnectAsync("127.0.0.1", port);
                    if (!connect.Wait(timeoutMilliseconds)) return false;
                    return client.Connected;
                }
            }
            catch
            {
                return false;
            }
        }

        private void KillSupervisors()
        {
            try
            {
                if (_supervisor != null && !_supervisor.HasExited)
                {
                    _supervisor.Kill(true);
                    _supervisor.WaitForExit(5000);
                }
            }
            catch
            {
                // Already gone.
            }

            try
            {
                var info = new ProcessStartInfo("powershell.exe")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                info.ArgumentList.Add("-NoProfile");
                info.ArgumentList.Add("-NonInteractive");
                info.ArgumentList.Add("-WindowStyle");
                info.ArgumentList.Add("Hidden");
                info.ArgumentList.Add("-ExecutionPolicy");
                info.ArgumentList.Add("Bypass");
                info.ArgumentList.Add("-Command");
                info.ArgumentList.Add(
                    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
                    "Where-Object { $_.CommandLine -like '*scripts\\serve-live.mjs*' } | " +
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");

                using (var cleanup = Process.Start(info))
                {
                    cleanup?.WaitForExit(15000);
                }
            }
            catch
            {
                // Best effort: the port sweep below still frees the listeners.
            }
        }

        private static void KillPortOwners()
        {
            try
            {
                var info = new ProcessStartInfo("netstat.exe", "-ano -p tcp")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };

                string output;
                using (var netstat = Process.Start(info))
                {
                    if (netstat == null) return;
                    output = netstat.StandardOutput.ReadToEnd();
                    netstat.WaitForExit(8000);
                }

                var ports = new[] { ":5173", ":8787", ":8788" };
                var owners = new HashSet<int>();
                foreach (var line in output.Split('\n'))
                {
                    if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (!ports.Any(port => line.Contains(port))) continue;

                    var parts = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                    int pid;
                    if (parts.Length > 0 && int.TryParse(parts[parts.Length - 1], out pid)) owners.Add(pid);
                }

                foreach (var pid in owners)
                {
                    if (pid <= 4) continue;
                    try
                    {
                        using (var process = Process.GetProcessById(pid))
                        {
                            process.Kill(true);
                        }
                    }
                    catch
                    {
                        // Process already exited.
                    }
                }
            }
            catch
            {
                // Best effort only.
            }
        }

        private void AppendLog(string? line)
        {
            if (string.IsNullOrWhiteSpace(line) || LogFile.Length == 0) return;
            try
            {
                lock (_logLock)
                {
                    File.AppendAllText(LogFile, DateTime.Now.ToString("HH:mm:ss") + "  " + line + Environment.NewLine);
                }
            }
            catch
            {
                // Logging must never take the app down.
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            // Deliberately does not stop the services: the dashboard stays
            // available on the LAN when the app window is closed.
            _supervisor?.Dispose();
        }
    }
}
