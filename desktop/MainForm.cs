using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace EnvisDashboard
{
    internal sealed class MainForm : Form
    {
        private readonly ServiceHost _services = new ServiceHost();
        private readonly EventWaitHandle _showEvent;
        private readonly CancellationTokenSource _cancellation = new CancellationTokenSource();

        private readonly Panel _splash = new Panel();
        private readonly PictureBox _logo = new PictureBox();
        private readonly Label _title = new Label();
        private readonly Label _subtitle = new Label();
        private readonly Label _status = new Label();
        private readonly Label _detail = new Label();
        private readonly Label _footer = new Label();
        private readonly ProgressBar _progress = new ProgressBar();
        private readonly WebView2 _webView = new WebView2();
        private readonly System.Windows.Forms.Timer _syncTimer = new System.Windows.Forms.Timer();
        private bool _syncing;
        private readonly NotifyIcon _tray = new NotifyIcon();

        private bool _webReady;
        private bool _exiting;
        private bool _busy;
        private bool _balloonShown;

        private const int SwShowNormal = 1;
        private const int SwRestore = 9;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr handle, int command);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr handle);

        public MainForm(EventWaitHandle showEvent)
        {
            _showEvent = showEvent;

            Text = "ENVIS Dashboard - Region VII";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1500, 920);
            MinimumSize = new Size(1024, 700);
            BackColor = Color.FromArgb(4, 11, 9);
            AutoScaleMode = AutoScaleMode.Dpi;
            KeyPreview = true;

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // Fall back to the default application icon.
            }

            BuildSplash();
            BuildWebView();
            BuildTray();
            WatchForSecondLaunch();
        }

        private void BuildSplash()
        {
            _splash.Dock = DockStyle.Fill;
            _splash.BackColor = Color.FromArgb(4, 11, 9);

            _logo.Size = new Size(96, 96);
            _logo.SizeMode = PictureBoxSizeMode.Zoom;
            _logo.BackColor = Color.Transparent;
            try
            {
                if (Icon != null) _logo.Image = Icon.ToBitmap();
            }
            catch
            {
                // Logo is decorative.
            }

            _title.AutoSize = false;
            _title.Size = new Size(720, 80);
            _title.TextAlign = ContentAlignment.MiddleCenter;
            _title.Font = new Font("Segoe UI", 42F, FontStyle.Bold, GraphicsUnit.Point);
            _title.ForeColor = Color.FromArgb(110, 231, 183);
            _title.Text = "ENVIS";

            _subtitle.AutoSize = false;
            _subtitle.Size = new Size(720, 30);
            _subtitle.TextAlign = ContentAlignment.MiddleCenter;
            _subtitle.Font = new Font("Segoe UI", 11F, FontStyle.Regular, GraphicsUnit.Point);
            _subtitle.ForeColor = Color.FromArgb(142, 169, 161);
            _subtitle.Text = "Region VII   |   Environmental Management Bureau";

            _status.AutoSize = false;
            _status.Size = new Size(720, 28);
            _status.TextAlign = ContentAlignment.MiddleCenter;
            _status.Font = new Font("Segoe UI", 10.5F, FontStyle.Regular, GraphicsUnit.Point);
            _status.ForeColor = Color.FromArgb(231, 244, 239);
            _status.Text = "Starting the dashboard...";

            _detail.AutoSize = false;
            _detail.Size = new Size(720, 48);
            _detail.TextAlign = ContentAlignment.TopCenter;
            _detail.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _detail.ForeColor = Color.FromArgb(100, 116, 139);
            _detail.Text = "Checking whether the services are already running.";

            _progress.Size = new Size(380, 8);
            _progress.Style = ProgressBarStyle.Marquee;
            _progress.MarqueeAnimationSpeed = 28;

            _footer.AutoSize = false;
            _footer.Size = new Size(720, 24);
            _footer.TextAlign = ContentAlignment.MiddleCenter;
            _footer.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _footer.ForeColor = Color.FromArgb(71, 85, 105);
            _footer.Text = "CY 2026   |   Live workbook sync";

            _splash.Controls.Add(_logo);
            _splash.Controls.Add(_title);
            _splash.Controls.Add(_subtitle);
            _splash.Controls.Add(_status);
            _splash.Controls.Add(_progress);
            _splash.Controls.Add(_detail);
            _splash.Controls.Add(_footer);

            Controls.Add(_splash);
            _splash.BringToFront();

            Resize += delegate { LayoutSplash(); };
            LayoutSplash();
        }

        private void LayoutSplash()
        {
            if (_splash == null || _splash.ClientSize.Width == 0) return;

            var width = _splash.ClientSize.Width;
            var middle = _splash.ClientSize.Height / 2;

            _logo.Left = (width - _logo.Width) / 2;
            _logo.Top = middle - 230;

            _title.Left = (width - _title.Width) / 2;
            _title.Top = _logo.Bottom + 10;

            _subtitle.Left = (width - _subtitle.Width) / 2;
            _subtitle.Top = _title.Bottom + 2;

            _status.Left = (width - _status.Width) / 2;
            _status.Top = _subtitle.Bottom + 40;

            _progress.Left = (width - _progress.Width) / 2;
            _progress.Top = _status.Bottom + 12;

            _detail.Left = (width - _detail.Width) / 2;
            _detail.Top = _progress.Bottom + 14;

            _footer.Left = (width - _footer.Width) / 2;
            _footer.Top = _splash.ClientSize.Height - 48;
        }

        private void BuildWebView()
        {
            _webView.Dock = DockStyle.Fill;
            _webView.DefaultBackgroundColor = Color.FromArgb(4, 11, 9);
            _webView.Visible = true;
            Controls.Add(_webView);
            _webView.SendToBack();
        }

        private void BuildTray()
        {
            var menu = new ContextMenuStrip
            {
                ShowImageMargin = false,
            };

            menu.Items.Add("Open dashboard", null, delegate { RestoreWindow(); });
            menu.Items.Add(new ToolStripSeparator());
            if (_services.CanUseOfflineCopy)
            {
                var modeItem = new ToolStripMenuItem("Switch to offline copy");
                modeItem.Click += async delegate
                {
                    await SwitchModeAsync(!_services.IsOfflineCopy);
                };
                menu.Opening += delegate
                {
                    modeItem.Text = _services.IsOfflineCopy ? "Switch to live dashboard" : "Switch to offline copy";
                };
                menu.Items.Add(modeItem);
                menu.Items.Add(new ToolStripSeparator());
            }
            if (!_services.IsRemote)
            {
                menu.Items.Add("Restart services", null, async delegate { await RestartServicesAsync(); });
                menu.Items.Add("Stop services", null, async delegate { await StopServicesAsync(); });
                menu.Items.Add(new ToolStripSeparator());
            }
            menu.Items.Add("Status...", null, delegate { ShowStatus(); });
            menu.Items.Add("Open logs folder", null, delegate { OpenLogsFolder(); });
            menu.Items.Add(new ToolStripSeparator());
            if (_services.IsRemote)
            {
                menu.Items.Add("Exit", null, delegate { ExitApp(false); });
            }
            else
            {
                menu.Items.Add("Exit (keep services running)", null, delegate { ExitApp(false); });
                menu.Items.Add("Exit and stop services", null, delegate { ExitApp(true); });
            }

            _tray.Icon = Icon ?? SystemIcons.Application;
            _tray.Text = "ENVIS Dashboard";
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { RestoreWindow(); };
            _tray.Visible = true;
        }

        private void WatchForSecondLaunch()
        {
            ThreadPool.RegisterWaitForSingleObject(
                _showEvent,
                delegate
                {
                    try
                    {
                        BeginInvoke(new Action(RestoreWindow));
                    }
                    catch
                    {
                        // The form is already closing.
                    }
                },
                null,
                Timeout.Infinite,
                false);
        }

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);

            // Windows applies the parent process show-state to the first
            // ShowWindow call. A shortcut or installer that starts us hidden
            // would otherwise leave the window invisible behind the tray icon.
            ForceOnScreen();

            await StartAsync();
        }

        private void ForceOnScreen()
        {
            try
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                ShowWindow(Handle, SwRestore);
                ShowWindow(Handle, SwShowNormal);
                SetForegroundWindow(Handle);
            }
            catch
            {
                // Cosmetic: the tray icon can still restore the window.
            }
        }

        private async Task StartAsync()
        {
            try
            {
                if (!_services.IsReady) throw new InvalidOperationException(_services.SetupError);

                if (_services.IsRemote)
                {
                    ShowSplash("Connecting to the live dashboard...", "Looking for the office host, then the internet dashboard.");
                    AppendNote("remote mode: checking " + _services.BaseUrl);

                    await _services.StartRemoteAsync(_cancellation.Token);

                    if (_services.IsOfflineCopy)
                    {
                        SetStatus("Opening the offline copy...", "No live dashboard is reachable. Showing the last synced data.");
                        AppendNote("no live dashboard reachable; using the offline copy");
                    }
                    else if (_services.IsOnlineLive)
                    {
                        ShowSplash("Connected over the internet...", "Loading the newest dashboard and data.");
                        AppendNote("internet dashboard reachable; using it");
                    }
                    else
                    {
                        ShowSplash("Connected to the shared dashboard...", "Loading live data from the host PC.");
                        AppendNote("host reachable; using live data");
                    }
                }
                else
                {
                    ShowSplash("Starting the dashboard...", "Checking whether the services are already running.");

                    var started = _services.StartSupervisor();
                    if (started)
                    {
                        SetStatus("Starting the dashboard...", "Launching the web server, API and planning watcher.");
                    }
                    else
                    {
                        SetStatus("Connecting to the running dashboard...", "The services are already live.");
                    }

                    AppendNote(started
                        ? "launching the services via the supervisor"
                        : "services already live; connecting to them");
                }

                await _services.WaitUntilLiveAsync(
                    TimeSpan.FromSeconds(120),
                    message => SetStatus(message, _services.IsRemote
                        ? "The host PC must be switched on and on the same office network."
                        : "The first run can take up to a minute."),
                    _cancellation.Token);

                SetStatus("Loading the dashboard...", "Opening the app window.");
                await EnsureWebViewAsync(_cancellation.Token);

                HideSplash();
                AppendNote("dashboard loaded");

                if (_services.IsRemote && !_services.IsOfflineCopy)
                {
                    StartOfflineSync();
                }
            }
            catch (OperationCanceledException) when (!_cancellation.IsCancellationRequested)
            {
                // Defensive: a stray timeout must never be mistaken for a shutdown.
                ReportStartupFailure("The dashboard did not finish loading in time.");
            }
            catch (OperationCanceledException)
            {
                // The app is shutting down.
            }
            catch (Exception error)
            {
                AppendNote("startup failed: " + error.GetType().Name + ": " + error.Message);
                ReportStartupFailure(error.Message);
            }
        }

        private void ReportStartupFailure(string message)
        {
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 0;
            SetStatus("The dashboard could not be started", "Review the message below, then try again.");
            var openBrowser = MessageBox.Show(
                this,
                message + "\n\nOpen the dashboard in a browser instead?",
                "ENVIS Dashboard",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);

            if (openBrowser == DialogResult.Yes) OpenBrowserFallback();
        }

        private async Task EnsureWebViewAsync(CancellationToken cancellationToken)
        {
            if (!_webReady)
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ENVIS Dashboard",
                    "WebView2");
                Directory.CreateDirectory(userData);

                var environment = await CoreWebView2Environment.CreateAsync(null, userData);
                await _webView.EnsureCoreWebView2Async(environment);

                var core = _webView.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = true;

                core.NavigationStarting += delegate (object? sender, CoreWebView2NavigationStartingEventArgs args)
                {
                    if (!IsAllowedNavigation(args.Uri))
                    {
                        args.Cancel = true;
                        AppendNote("blocked navigation to " + args.Uri);
                    }
                };

                core.NewWindowRequested += delegate (object? sender, CoreWebView2NewWindowRequestedEventArgs args)
                {
                    args.Handled = true;
                    if (!IsAllowedNavigation(args.Uri))
                    {
                        AppendNote("blocked popup to " + args.Uri);
                        return;
                    }
                    try
                    {
                        Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                    }
                    catch
                    {
                        // A blocked popup is not worth interrupting the dashboard.
                    }
                };

                core.ProcessFailed += delegate (object? sender, CoreWebView2ProcessFailedEventArgs args)
                {
                    SetStatus("The app window stopped responding", "Close and reopen ENVIS Dashboard from the tray icon.");
                    AppendNote("webview process failed: " + args.ProcessFailedKind);
                };

                core.WebMessageReceived += HandlePageMessage;

                _webReady = true;
            }

            await NavigateAndWaitAsync(cancellationToken).ConfigureAwait(true);
        }

        /// <summary>
        /// The WebView may only show the current dashboard origin, the installed
        /// snapshot, or the configured public site. This stops a data-driven
        /// link from turning the window into an arbitrary browser.
        /// </summary>
        private bool IsAllowedNavigation(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
            if (string.Equals(uri.Scheme, "about", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Scheme, "data", StringComparison.OrdinalIgnoreCase)) return true;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return false;

            var authority = uri.GetLeftPart(UriPartial.Authority);
            if (string.Equals(authority, "https://envis.local", StringComparison.OrdinalIgnoreCase) &&
                _services.IsOfflineCopy) return true;
            if (Uri.TryCreate(_services.BaseUrl, UriKind.Absolute, out var current) &&
                string.Equals(authority, current.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)) return true;
            if (_services.OnlineUrl != null &&
                Uri.TryCreate(_services.OnlineUrl, UriKind.Absolute, out var online) &&
                string.Equals(authority, online.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// Maps the installed snapshot to a normal https origin. Safe to call on
        /// every navigation, so switching modes at runtime keeps working.
        /// </summary>
        private void ApplyOfflineMapping(CoreWebView2 core)
        {
            if (!_services.IsOfflineCopy || _services.OfflineAppDirectory == null) return;
            core.SetVirtualHostNameToFolderMapping(
                "envis.local",
                _services.OfflineAppDirectory,
                CoreWebView2HostResourceAccessKind.DenyCors);
        }

        /// <summary>
        /// Navigates to the dashboard and waits for the first successful load, so
        /// the splash stays visible instead of showing a black window while
        /// WebView2 boots (a cold start can take several seconds).
        /// </summary>
        private async Task NavigateAndWaitAsync(CancellationToken cancellationToken)
        {
            var core = _webView.CoreWebView2;
            if (core == null) throw new InvalidOperationException("The app window is not available.");

            ApplyOfflineMapping(core);

            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = null!;
            handler = delegate (object? sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                if (args.IsSuccess) completion.TrySetResult(true);
                else completion.TrySetException(new InvalidOperationException(
                    "The dashboard page did not load (" + args.WebErrorStatus + ")."));
            };

            core.NavigationCompleted += handler;
            try
            {
                core.Navigate(_services.BaseUrl);

                var waited = await Task.WhenAny(
                    completion.Task,
                    Task.Delay(TimeSpan.FromSeconds(45), cancellationToken)).ConfigureAwait(true);

                if (waited != completion.Task)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    throw new TimeoutException(
                        "The dashboard page did not finish loading within 45 seconds. See the log: " + _services.LogFile);
                }

                // Surface a navigation failure to the caller.
                await completion.Task.ConfigureAwait(true);
            }
            finally
            {
                core.NavigationCompleted -= handler;
            }
        }

        private void StartOfflineSync()
        {            _ = SyncOfflineAsync();

            _syncTimer.Interval = (int)TimeSpan.FromMinutes(15).TotalMilliseconds;
            _syncTimer.Tick += async delegate { await SyncOfflineAsync(); };
            _syncTimer.Start();
        }

        /// <summary>Best effort: a failed sync must never interrupt the dashboard.</summary>
        private async Task SyncOfflineAsync()
        {
            if (_syncing || _cancellation.IsCancellationRequested) return;
            _syncing = true;
            try
            {
                // ServiceHost writes the summary to the same log.
                await _services.SyncOfflineCopyAsync(_cancellation.Token);
            }
            catch (OperationCanceledException)
            {
                // The app is shutting down.
            }
            catch (Exception error)
            {
                AppendNote("offline sync failed: " + error.Message);
            }
            finally
            {
                _syncing = false;
            }
        }

        /// <summary>
        /// Handles the sign-in screen's "Connect to the live dashboard" button.
        /// The page stays put when nothing is reachable, so it can explain why.
        /// </summary>
        private async void HandlePageMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (_busy) return;
            try
            {
                using (var message = JsonDocument.Parse(args.WebMessageAsJson))
                {
                    var root = message.RootElement;
                    if (!root.TryGetProperty("type", out var type) || type.GetString() != "envis:switch") return;
                    var mode = root.TryGetProperty("mode", out var value) ? value.GetString() : null;

                    if (mode == "offline")
                    {
                        if (!_services.CanUseOfflineCopy)
                        {
                            PostSwitchResult(false, "The offline copy is not installed on this PC. Run the ENVIS Dashboard setup again to restore it.");
                            return;
                        }
                        await SwitchModeAsync(true);
                        return;
                    }
                    if (mode != "online") return;

                    _busy = true;
                    try
                    {
                        ShowSplash(
                            "Connecting to the live dashboard...",
                            _services.IsRemote
                                ? "Looking for the office host, then the internet dashboard."
                                : "Starting the dashboard services on this PC.");
                        var live = await _services.TryUseLiveHostAsync(_cancellation.Token);
                        if (!live)
                        {
                            HideSplash();
                            PostSwitchResult(false, !_services.IsRemote
                                ? "The dashboard services on this PC are not running. Use Restart services from the tray menu, then try again."
                                : _services.OnlineUrl == null
                                    ? "No live dashboard is configured. Ask MIS to set it in the installer, or connect to the office LAN."
                                    : "The office host and the internet dashboard are not reachable right now.");
                            AppendNote("page asked for the live dashboard; nothing reachable");
                            return;
                        }

                        await EnsureWebViewAsync(_cancellation.Token);
                        HideSplash();
                        AppendNote("switched to the live dashboard from the sign-in screen");
                    }
                    finally
                    {
                        _busy = false;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // The app is shutting down.
            }
            catch (Exception error)
            {
                AppendNote("live switch failed: " + error.Message);
                PostSwitchResult(false, "The live dashboard could not be opened. The offline view is still available.");
            }
        }

        private void PostSwitchResult(bool ok, string? message)
        {
            try
            {
                _webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "envis:switch-result",
                    ok,
                    message = message ?? string.Empty,
                }));
            }
            catch
            {
                // The page navigated away: nothing to tell.
            }
        }

        /// <summary>
        /// Lets the user pick the live host or the offline copy from the tray,
        /// e.g. to check synced data before leaving the office network.
        /// </summary>
        private async Task SwitchModeAsync(bool useOfflineCopy)
        {
            if (_busy) return;
            _busy = true;
            try
            {
                if (useOfflineCopy)
                {
                    _services.UseOfflineCopy();
                    ShowSplash("Opening the offline copy...", "Showing the last data synced from the host PC.");
                }
                else
                {
                    ShowSplash(
                        "Connecting to the live dashboard...",
                        _services.IsRemote
                            ? "Looking for the office host, then the internet dashboard."
                            : "Starting the dashboard services on this PC.");
                    if (!await _services.TryUseLiveHostAsync(_cancellation.Token))
                    {
                        _services.UseOfflineCopy();
                        MessageBox.Show(
                            this,
                            _services.IsRemote
                                ? "The office host and the internet dashboard are not reachable right now.\n\nThe offline copy stays open."
                                : "The dashboard services on this PC did not start.\n\nThe offline copy stays open.",
                            "ENVIS Dashboard",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                        AppendNote("live dashboard unreachable; stayed on the offline copy");
                    }
                }

                await EnsureWebViewAsync(_cancellation.Token);
                HideSplash();
                AppendNote(_services.IsOfflineCopy
                    ? "showing the offline copy"
                    : _services.IsOnlineLive ? "showing the internet dashboard" : "showing the live host");
            }
            catch (OperationCanceledException)
            {
                // The app is shutting down.
            }
            catch (Exception error)
            {
                SetStatus("Could not switch view", "Check the log for details.");
                MessageBox.Show(this, error.Message, "ENVIS Dashboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                _busy = false;
            }
        }

        private async Task RestartServicesAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                ShowSplash("Restarting the dashboard...", "Stopping and starting the web server, API and planning watcher.");
                await _services.RestartAsync(message => SetStatus(message), _cancellation.Token);
                await EnsureWebViewAsync(_cancellation.Token);
                HideSplash();
            }
            catch (OperationCanceledException)
            {
                // The app is shutting down.
            }
            catch (Exception error)
            {
                SetStatus("Restart failed", "Check the log for details.");
                MessageBox.Show(this, error.Message, "ENVIS Dashboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                _busy = false;
            }
        }

        private async Task StopServicesAsync()
        {
            if (_busy) return;

            var answer = MessageBox.Show(
                this,
                "Stop the dashboard, API and planning watcher?\n\nColleagues using the LAN address will lose access until the services are started again.",
                "Stop services",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;

            _busy = true;
            try
            {
                ShowSplash("Stopping the dashboard...", "Stopping the web server, API and planning watcher.");
                await _services.StopAsync();
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = 0;
                SetStatus("Services stopped", "Use Restart services from the tray menu to start them again.");
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "ENVIS Dashboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                _busy = false;
            }
        }

        private void ShowStatus()
        {
            MessageBox.Show(
                this,
                _services.DescribeStatus(),
                "ENVIS Dashboard status",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void OpenLogsFolder()
        {
            try
            {
                _services.OpenLogsFolder();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "ENVIS Dashboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenBrowserFallback()
        {
            try
            {
                var browser = FindChromiumBrowser();
                if (browser != null)
                {
                    var profile = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "ENVIS Dashboard",
                        "BrowserProfile");
                    Directory.CreateDirectory(profile);

                    var info = new ProcessStartInfo(browser)
                    {
                        UseShellExecute = false,
                        Arguments = "--app=" + _services.BaseUrl +
                                    " --window-size=1500,920 --user-data-dir=\"" + profile + "\"",
                    };
                    Process.Start(info);
                }
                else
                {
                    Process.Start(new ProcessStartInfo(_services.BaseUrl) { UseShellExecute = true });
                }
            }
            catch
            {
                Process.Start(new ProcessStartInfo(_services.BaseUrl) { UseShellExecute = true });
            }
        }

        private static string? FindChromiumBrowser()
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            var candidates = new[]
            {
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
            };

            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }

            return null;
        }

        private void RestoreWindow()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            ForceOnScreen();
            BringToFront();
            if (_webReady && _webView.CoreWebView2 != null)
            {
                _webView.Focus();
            }
        }

        private void ShowSplash(string status, string detail)
        {
            _status.Text = status;
            _detail.Text = detail;
            _progress.Style = ProgressBarStyle.Marquee;
            _progress.MarqueeAnimationSpeed = 28;
            _splash.Visible = true;
            _splash.BringToFront();
        }

        private void HideSplash()
        {
            _splash.Visible = false;
            _webView.BringToFront();
            _webView.Visible = true;
            _webView.Focus();
        }

        private void SetStatus(string message, string? detail = null)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try
                {
                    BeginInvoke(new Action(() => SetStatus(message, detail)));
                }
                catch
                {
                    // The window is closing.
                }

                return;
            }

            _status.Text = message;
            if (detail != null) _detail.Text = detail;
        }

        private void AppendNote(string message)
        {
            try
            {
                var log = _services.LogFile;
                if (log.Length == 0) return;
                Directory.CreateDirectory(Path.GetDirectoryName(log) ?? ".");
                File.AppendAllText(log, DateTime.Now.ToString("HH:mm:ss") + "  [app] " + message + Environment.NewLine);
            }
            catch
            {
                // Notes are best effort.
            }
        }

        private async void ExitApp(bool stopServices)
        {
            if (_exiting) return;
            _exiting = true;

            try
            {
                if (stopServices)
                {
                    ShowSplash("Stopping the dashboard...", "Closing the web server, API and planning watcher.");
                    await _services.StopAsync();
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "ENVIS Dashboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }

            _tray.Visible = false;
            _cancellation.Cancel();
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!_exiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();

                if (!_balloonShown)
                {
                    _balloonShown = true;
                    _tray.ShowBalloonTip(
                        4000,
                        "ENVIS Dashboard is still running",
                        _services.IsRemote
                            ? "The app keeps the live dashboard or your offline copy ready. Right-click the tray icon to reopen or exit."
                            : "The dashboard, API and planning watcher keep serving the LAN. Right-click the tray icon to reopen or exit.",
                        ToolTipIcon.Info);
                }

                return;
            }

            base.OnFormClosing(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            _cancellation.Cancel();
            _tray.Visible = false;
            _syncTimer.Stop();
            _syncTimer.Dispose();
            _tray.Dispose();
            _webView.Dispose();
            _services.Dispose();
            _cancellation.Dispose();
            base.OnFormClosed(e);
        }
    }
}
