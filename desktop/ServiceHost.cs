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
        private readonly object _logLock = new object();
        private Process? _supervisor;
        private bool _disposed;
        private readonly string? _remoteServer;
        private readonly string? _onlineUrl;
        private readonly string? _syncToken;
        private readonly string? _offlineAppDirectory;

        public const string OfflineHost = "https://envis.local/index.html";

        /// <summary>The dashboard this app starts itself in local host mode.</summary>
        public const string LocalHost = "http://127.0.0.1:5173";

        private static readonly HttpClient Http = new HttpClient
        {
            // Per-request timeouts are applied with a linked token below, so a
            // slow first response is a retry, not a fatal error.
            Timeout = Timeout.InfiniteTimeSpan,
        };

        /// <summary>
        /// Local dashboard URL, or the shared host's URL when this app was
        /// installed in client mode (config.json "serverUrl").
        /// </summary>
        public string BaseUrl { get; private set; }

        /// <summary>
        /// True when the shared host was unreachable and the app is showing the
        /// last synced offline copy stored under %LOCALAPPDATA%.
        /// </summary>
        public bool IsOfflineCopy { get; private set; }

        /// <summary>True when the app is showing the public dashboard over the internet.</summary>
        public bool IsOnlineLive { get; private set; }

        /// <summary>The configured public dashboard URL, or null.</summary>
        public string? OnlineUrl
        {
            get { return _onlineUrl; }
        }

        /// <summary>True when Setup installed the static snapshot this client can fall back to.</summary>
        public bool CanUseOfflineCopy
        {
            get { return _offlineAppDirectory != null; }
        }

        /// <summary>Shows the installed snapshot without waiting for the host.</summary>
        public void UseOfflineCopy()
        {
            if (_offlineAppDirectory == null) return;
            RefreshLocalGate();
            IsOfflineCopy = true;
            IsOnlineLive = false;
            BaseUrl = OfflineHost;
        }

        /// <summary>
        /// On the host PC there is no LAN sync, so the installed copy would keep
        /// the password MIS set before the snapshot was built. Refresh it from
        /// the live dashboard's file every time we open the copy.
        /// </summary>
        private void RefreshLocalGate()
        {
            if (IsRemote || ProjectRoot == null) return;
            var source = Path.Combine(ProjectRoot, "offline-access.json");
            var target = Path.Combine(_offlineAppDirectory!, "data", "offline-access.json");
            try
            {
                if (!File.Exists(source)) return;
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(source, target, true);
                AppendLog("[app] offline gate refreshed from the live dashboard");
            }
            catch (Exception error)
            {
                AppendLog("[app] could not refresh the offline gate: " + error.Message);
            }
        }

        /// <summary>Returns to the LAN host, or the public site when no host is configured.</summary>
        public void UseLiveHost()
        {
            IsOfflineCopy = false;
            IsOnlineLive = _remoteServer == null && _onlineUrl != null;
            BaseUrl = _remoteServer ?? _onlineUrl ?? LocalHost;
        }

        /// <summary>Shows the public dashboard (internet mode).</summary>
        public void UseOnlineSite()
        {
            if (_onlineUrl == null) return;
            IsOfflineCopy = false;
            IsOnlineLive = true;
            BaseUrl = _onlineUrl;
        }

        /// <summary>
        /// Office host first, then the public site. In local host mode it returns
        /// to this PC's own dashboard, starting the services again if they were
        /// stopped. Returns false when nothing answers; the caller decides
        /// whether to fall back to the offline copy.
        /// </summary>
        public async Task<bool> TryUseLiveHostAsync(CancellationToken cancellationToken)
        {
            if (!IsRemote)
            {
                BaseUrl = LocalHost;
                IsOfflineCopy = false;
                IsOnlineLive = false;

                if (await IsSiteLiveAsync(cancellationToken).ConfigureAwait(false)) return true;

                try
                {
                    StartSupervisor();
                    AppendLog("[app] local dashboard not running; restarting the services");
                    await WaitUntilLiveAsync(TimeSpan.FromSeconds(90), null, cancellationToken).ConfigureAwait(false);
                    return true;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception error)
                {
                    AppendLog("[app] local dashboard did not start: " + error.Message);
                    return false;
                }
            }

            if (await ProbeAsync(_remoteServer, "/api/health", cancellationToken).ConfigureAwait(false))
            {
                UseLiveHost();
                AppendLog("[app] office host reachable: " + _remoteServer);
                return true;
            }

            if (await ProbeAsync(_onlineUrl, string.Empty, cancellationToken).ConfigureAwait(false))
            {
                UseOnlineSite();
                AppendLog("[app] internet dashboard reachable: " + _onlineUrl);
                return true;
            }

            return false;
        }

        public string? OfflineAppDirectory
        {
            get { return _offlineAppDirectory; }
        }

        public bool IsRemote
        {
            get { return _remoteServer != null || _onlineUrl != null; }
        }

        public string? ProjectRoot { get; }
        public string? NodePath { get; }
        public string SetupError { get; }

        public bool IsReady
        {
            get { return IsRemote || (SetupError.Length == 0 && ProjectRoot != null && NodePath != null); }
        }

        public string LogFile
        {
            get
            {
                if (ProjectRoot == null)
                {
                    return Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "ENVIS Dashboard",
                        "desktop-app.log");
                }
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
            _offlineAppDirectory = LocateOfflineApp();
            _onlineUrl = ReadConfiguredOnlineUrl();
            _syncToken = ReadConfiguredSyncToken();

            var configuredServer = ReadConfiguredServer();
            if (configuredServer != null || _onlineUrl != null)
            {
                // Client mode: the host PC runs the services and owns the data.
                _remoteServer = configuredServer;
                BaseUrl = configuredServer ?? _onlineUrl!;
                SetupError = string.Empty;
                return;
            }

            BaseUrl = "http://127.0.0.1:5173";

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

        /// <summary>
        /// The offline copy installed beside the app configuration, or
        /// ENVIS_OFFLINE_APP for a local test build.
        /// </summary>
        private static string? LocateOfflineApp()
        {
            var candidates = new List<string>();
            var overridden = Environment.GetEnvironmentVariable("ENVIS_OFFLINE_APP");
            if (!string.IsNullOrWhiteSpace(overridden)) candidates.Add(overridden.Trim());
            candidates.Add(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ENVIS Dashboard",
                "offline-app"));

            foreach (var candidate in candidates)
            {
                try
                {
                    if (File.Exists(Path.Combine(candidate, "index.html"))) return Path.GetFullPath(candidate);
                }
                catch
                {
                    // Ignore an unusable path and try the next one.
                }
            }

            return null;
        }

        /// <summary>
        /// Picks the office host, then the public site, then the installed copy.
        /// Only called in client mode; local mode keeps starting the services.
        /// </summary>
        public async Task<bool> StartRemoteAsync(CancellationToken cancellationToken)
        {
            if (!IsRemote) return false;

            if (await TryUseLiveHostAsync(cancellationToken).ConfigureAwait(false)) return true;

            if (_offlineAppDirectory != null)
            {
                UseOfflineCopy();
                AppendLog("[app] no live dashboard reachable; opening the offline copy at " + _offlineAppDirectory);
                return false;
            }

            UseLiveHost();
            AppendLog("[app] no live dashboard reachable and no offline copy is installed");
            return false;
        }

        /// <summary>Adds the shared LAN sync token so /sync/* is not world-readable.</summary>
        private HttpRequestMessage SyncRequest(string url)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrWhiteSpace(_syncToken))
            {
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + _syncToken);
            }
            return request;
        }

        private static async Task<bool> ProbeAsync(string? baseUrl, string path, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(baseUrl)) return false;

            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(4));
                try
                {
                    using (var response = await Http.GetAsync(
                        baseUrl.TrimEnd('/') + path,
                        HttpCompletionOption.ResponseHeadersRead,
                        timeout.Token).ConfigureAwait(false))
                    {
                        return response.IsSuccessStatusCode;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch
                {
                    // Off, wrong network, or no internet: try the next target.
                    return false;
                }
            }
        }

        /// <summary>
        /// Copies new or changed datasets from the host into the offline copy.
        /// Safe to call repeatedly; unchanged files are skipped by manifest mtime.
        /// </summary>
        public async Task<string> SyncOfflineCopyAsync(CancellationToken cancellationToken)
        {
            if (!IsRemote || _remoteServer == null || _offlineAppDirectory == null || IsOfflineCopy || IsOnlineLive)
            {
                return "offline sync skipped";
            }

            var offlineDir = _offlineAppDirectory;
            var stateFile = Path.Combine(offlineDir, "sync.json");
            var synced = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (File.Exists(stateFile))
                {
                    using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(stateFile)))
                    {
                        System.Text.Json.JsonElement files;
                        if (document.RootElement.TryGetProperty("files", out files))
                        {
                            foreach (var property in files.EnumerateObject())
                            {
                                synced[property.Name] = property.Value.GetInt64();
                            }
                        }
                    }
                }
            }
            catch
            {
                // A damaged state file only costs a full re-copy.
                synced.Clear();
            }

            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(TimeSpan.FromMinutes(10));

                string manifestText;
                using (var request = SyncRequest(_remoteServer + "/sync/manifest.json"))
                using (var manifest = await Http.SendAsync(
                    request,
                    HttpCompletionOption.ResponseContentRead,
                    timeout.Token).ConfigureAwait(false))
                {
                    if (!manifest.IsSuccessStatusCode)
                    {
                        throw new InvalidOperationException(
                            "The host does not offer data sync (HTTP " + (int)manifest.StatusCode + "). Update the project on the host PC.");
                    }
                    manifestText = await manifest.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
                }

                var updated = 0;
                var unchanged = 0;
                using (var document = System.Text.Json.JsonDocument.Parse(manifestText))
                {
                    foreach (var entry in document.RootElement.GetProperty("files").EnumerateArray())
                    {
                        timeout.Token.ThrowIfCancellationRequested();
                        var relative = entry.GetProperty("path").GetString();
                        // Never let a manifest entry escape the offline data folder.
                        if (string.IsNullOrWhiteSpace(relative) || relative.Contains("..") ||
                            relative.Contains('\\') || Path.IsPathRooted(relative)) continue;

                        var size = entry.GetProperty("size").GetInt64();
                        var mtime = entry.GetProperty("mtime").GetInt64();
                        var localPath = Path.Combine(offlineDir, "data",
                            relative.Replace('/', Path.DirectorySeparatorChar));

                        long knownMtime;
                        if (synced.TryGetValue(relative, out knownMtime) && knownMtime == mtime &&
                            File.Exists(localPath) && new FileInfo(localPath).Length == size)
                        {
                            unchanged += 1;
                            continue;
                        }

                        var escaped = string.Join("/", relative.Split('/').Select(Uri.EscapeDataString));
                        using (var request = SyncRequest(_remoteServer + "/sync/file/" + escaped))
                        using (var response = await Http.SendAsync(
                            request,
                            HttpCompletionOption.ResponseHeadersRead,
                            timeout.Token).ConfigureAwait(false))
                        {
                            if (!response.IsSuccessStatusCode)
                            {
                                throw new InvalidOperationException(
                                    "Cannot download data/" + relative + " (HTTP " + (int)response.StatusCode + ").");
                            }

                            Directory.CreateDirectory(Path.GetDirectoryName(localPath) ?? offlineDir);
                            var temporary = localPath + ".new";
                            using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                            {
                                await response.Content.CopyToAsync(output, timeout.Token).ConfigureAwait(false);
                            }
                            File.Move(temporary, localPath, true);
                        }

                        synced[relative] = mtime;
                        updated += 1;
                    }
                }

                var state = new StringBuilder();
                state.AppendLine("{");
                state.AppendLine("  \"syncedAt\": " + System.Text.Json.JsonSerializer.Serialize(DateTime.UtcNow.ToString("o")) + ",");
                state.AppendLine("  \"host\": " + System.Text.Json.JsonSerializer.Serialize(_remoteServer) + ",");
                state.AppendLine("  \"files\": {");
                var first = true;
                foreach (var pair in synced.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase))
                {
                    if (!first) state.AppendLine(",");
                    state.Append("    " + System.Text.Json.JsonSerializer.Serialize(pair.Key) + ": " + pair.Value);
                    first = false;
                }
                state.AppendLine();
                state.AppendLine("  }");
                state.AppendLine("}");
                File.WriteAllText(stateFile, state.ToString());

                var summary = "offline copy: " + updated + " updated, " + unchanged + " unchanged";
                AppendLog("[app] " + summary);
                return summary;
            }
        }

        /// <summary>Last successful sync time of the offline copy, or null.</summary>
        public DateTime? OfflineSyncedAt()
        {
            if (_offlineAppDirectory == null) return null;
            try
            {
                var stateFile = Path.Combine(_offlineAppDirectory, "sync.json");
                if (!File.Exists(stateFile)) return null;
                using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(stateFile)))
                {
                    System.Text.Json.JsonElement value;
                    if (document.RootElement.TryGetProperty("syncedAt", out value))
                    {
                        DateTime parsed;
                        if (DateTime.TryParse(value.GetString(), null,
                            System.Globalization.DateTimeStyles.RoundtripKind, out parsed))
                        {
                            return parsed.ToLocalTime();
                        }
                    }
                }
            }
            catch
            {
                // Treat an unreadable state file as "never synced".
            }

            return null;
        }

        /// <summary>
        /// Reads the shared server address written by the installer, or
        /// ENVIS_SERVER_URL for a temporary override. Empty means local mode.
        /// </summary>
        private static string? ReadConfiguredServer()
        {
            var candidate = Environment.GetEnvironmentVariable("ENVIS_SERVER_URL");
            var parsed = NormalizeServer(candidate);
            if (parsed != null) return parsed;

            var configPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ENVIS Dashboard",
                "config.json");

            try
            {
                if (!File.Exists(configPath)) return null;
                using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(configPath)))
                {
                    System.Text.Json.JsonElement value;
                    if (document.RootElement.TryGetProperty("serverUrl", out value))
                    {
                        return NormalizeServer(value.GetString());
                    }
                }
            }
            catch
            {
                // A malformed config must not stop the app.
            }

            return null;
        }

        private static string ConfigPath()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ENVIS Dashboard",
                "config.json");
        }

        /// <summary>
        /// The public dashboard URL written by the installer, or ENVIS_ONLINE_URL.
        /// Null disables internet mode.
        /// </summary>
        private static string? ReadConfiguredOnlineUrl()
        {
            var parsed = NormalizeOnlineUrl(Environment.GetEnvironmentVariable("ENVIS_ONLINE_URL"));
            if (parsed != null) return parsed;

            try
            {
                var configPath = ConfigPath();
                if (!File.Exists(configPath)) return null;
                using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(configPath)))
                {
                    System.Text.Json.JsonElement value;
                    if (document.RootElement.TryGetProperty("onlineUrl", out value))
                    {
                        return NormalizeOnlineUrl(value.GetString());
                    }
                }
            }
            catch
            {
                // A malformed config must not stop the app.
            }

            return null;
        }

        /// <summary>
        /// Shared secret for the host's /sync endpoints. Env var overrides config
        /// so the host process can be started with the MIS-issued token.
        /// </summary>
        private static string? ReadConfiguredSyncToken()
        {
            var fromEnvironment = Environment.GetEnvironmentVariable("ENVIS_SYNC_TOKEN");
            if (!string.IsNullOrWhiteSpace(fromEnvironment)) return fromEnvironment.Trim();
            try
            {
                if (!File.Exists(ConfigPath())) return null;
                using (var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(ConfigPath())))
                {
                    System.Text.Json.JsonElement value;
                    if (document.RootElement.TryGetProperty("syncToken", out value))
                    {
                        var token = value.GetString();
                        return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
                    }
                }
            }
            catch
            {
                // A malformed config must not stop the app.
            }
            return null;
        }

        private static string? NormalizeServer(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return null;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
            // Reject URLs that embed credentials in the authority (phishing).
            if (!string.IsNullOrEmpty(uri.UserInfo)) return null;
            return uri.GetLeftPart(UriPartial.Authority) + uri.AbsolutePath.TrimEnd('/');
        }

        /// <summary>Public internet destinations must use TLS.</summary>
        private static string? NormalizeOnlineUrl(string? value)
        {
            var parsed = NormalizeServer(value);
            if (parsed == null) return null;
            return parsed.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? parsed : null;
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
            // Client mode: the shared host owns the services.
            if (IsRemote) return false;

            EnsureReady();

            if (!force && IsPortOpen(5173)) return false;
            if (_supervisor != null && !_supervisor.HasExited) return false;

            var logsDirectory = Path.Combine(ProjectRoot!, "logs");
            Directory.CreateDirectory(logsDirectory);

            // These paths are written into a .cmd file. Fail closed on shell
            // metacharacters instead of trying to escape them.
            ValidateShellPath(ProjectRoot!);
            ValidateShellPath(NodePath!);
            ValidateShellPath(ServicesLogFile);

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
            // The token is passed through the environment, never written into a
            // script or log file.
            if (!string.IsNullOrWhiteSpace(_syncToken))
            {
                info.Environment["ENVIS_SYNC_TOKEN"] = _syncToken;
            }
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

        /// <summary>Rejects paths that would be reinterpreted by cmd.exe.</summary>
        internal static void ValidateShellPath(string path)
        {
            if (path.IndexOfAny(new[] { '"', '%', '&', '|', '<', '>', '^', '!', '(', ')' }) >= 0)
            {
                throw new InvalidOperationException(
                    "The configured dashboard path contains characters that cannot be used safely in a launcher. Move the project or change the path.");
            }
        }

        public async Task WaitUntilLiveAsync(TimeSpan timeout, Action<string>? progress, CancellationToken cancellationToken)
        {
            EnsureReady();

            // The offline copy is local files; there is no service to wait for.
            if (IsOfflineCopy) return;

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
            if (IsRemote)
            {
                throw new InvalidOperationException(
                    "This app is connected to a shared dashboard server. Restart the services on the host PC instead.");
            }

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
            if (IsRemote)
            {
                AppendLog("[app] remote mode: nothing to stop locally");
                return;
            }

            KillSupervisors();
            await Task.Delay(500).ConfigureAwait(false);
            KillPortOwners();
            await Task.Delay(600).ConfigureAwait(false);
            KillPortOwners();
            AppendLog("[app] services stopped");
        }

        public string DescribeStatus()
        {
            var text = new StringBuilder();

            if (IsRemote)
            {
                text.AppendLine("Mode ........... Client (LAN host, internet, or offline copy)");
                text.AppendLine("Office host .... " + (_remoteServer ?? "(not configured)"));
                text.AppendLine("Internet ....... " + (_onlineUrl ?? "(not configured)"));
                text.AppendLine("Now showing .... " + (IsOfflineCopy
                    ? "offline copy"
                    : IsOnlineLive ? "live dashboard (internet)" : "live host data"));
                var synced = OfflineSyncedAt();
                if (_offlineAppDirectory == null)
                {
                    text.AppendLine("Offline copy ... not installed");
                }
                else
                {
                    text.AppendLine("Offline copy ... " + (synced == null
                        ? "installed, waiting for its first sync"
                        : "last synced " + synced.Value.ToString("yyyy-MM-dd HH:mm")));
                    text.AppendLine("                 " + _offlineAppDirectory);
                }
                text.AppendLine();
                text.AppendLine("On the office LAN the app uses the host's live data and refreshes the");
                text.AppendLine("offline copy. On any other network it opens that copy automatically.");
                return text.ToString();
            }

            var site = IsPortOpen(5173);
            var api = IsPortOpen(8787);
            var planning = IsPortOpen(8788);

            text.AppendLine("Mode ........... Local host");
            text.AppendLine("Dashboard ...... " + (site ? "LIVE" : "DOWN") + "   " + BaseUrl);
            text.AppendLine("API ............ " + (api ? "LIVE" : "DOWN") + "   http://127.0.0.1:8787");
            text.AppendLine("Planning sync .. " + (planning ? "LIVE" : "DOWN") + "   http://127.0.0.1:8788");
            text.AppendLine();
            text.AppendLine("Share with colleagues (installed as client / SERVER:):");
            foreach (var address in LanAddresses())
            {
                text.AppendLine("  http://" + address + ":5173");
            }

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

        private static IEnumerable<string> LanAddresses()
        {
            var found = new List<string>();
            try
            {
                foreach (var network in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (network.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                    if (network.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
                    foreach (var address in network.GetIPProperties().UnicastAddresses)
                    {
                        if (address.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                        var value = address.Address.ToString();
                        if (value.StartsWith("169.254.")) continue;
                        found.Add(value);
                    }
                }
            }
            catch
            {
                // Best effort only.
            }

            return found;
        }

        public void OpenLogsFolder()
        {
            var logs = ProjectRoot == null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ENVIS Dashboard")
                : Path.Combine(ProjectRoot, "logs");
            Directory.CreateDirectory(logs);
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + logs + "\"") { UseShellExecute = true });
        }

        private void EnsureReady()
        {
            if (!IsReady) throw new InvalidOperationException(SetupError);
        }

        private async Task<bool> IsSiteLiveAsync(CancellationToken cancellationToken)
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
