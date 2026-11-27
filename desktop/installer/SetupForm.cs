using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace EnvisSetup
{
    internal sealed class SetupForm : Form
    {
        private static readonly Color Background = Color.FromArgb(4, 11, 9);
        private static readonly Color BrandBackground = Color.FromArgb(6, 18, 14);
        private static readonly Color Emerald = Color.FromArgb(110, 231, 183);
        private static readonly Color TextPrimary = Color.FromArgb(231, 244, 239);
        private static readonly Color TextMuted = Color.FromArgb(142, 169, 161);
        private static readonly Color TextFaint = Color.FromArgb(100, 116, 139);
        private static readonly Color FieldBackground = Color.FromArgb(11, 26, 21);
        private static readonly Color BorderColor = Color.FromArgb(30, 58, 48);

        private readonly Panel _brand = new Panel();
        private readonly PictureBox _logo = new PictureBox();
        private readonly Label _brandTitle = new Label();
        private readonly Label _brandSub = new Label();
        private readonly Label _brandRegion = new Label();
        private readonly Label _brandVersion = new Label();

        private readonly Label _title = new Label();
        private readonly Label _subtitle = new Label();

        private readonly Label _locationLabel = new Label();
        private readonly TextBox _location = new TextBox();
        private readonly Button _browseLocation = new Button();
        private readonly Label _locationHint = new Label();

        private readonly Label _projectLabel = new Label();
        private readonly TextBox _project = new TextBox();
        private readonly Button _browseProject = new Button();
        private readonly Label _projectHint = new Label();

        private readonly Label _serverLabel = new Label();
        private readonly TextBox _server = new TextBox();
        private readonly Label _serverHint = new Label();

        private readonly Label _onlineLabel = new Label();
        private readonly TextBox _online = new TextBox();
        private readonly Label _onlineHint = new Label();

        private readonly Label _syncLabel = new Label();
        private readonly TextBox _sync = new TextBox();
        private readonly Label _syncHint = new Label();

        private readonly CheckBox _startMenu = new CheckBox();
        private readonly CheckBox _desktop = new CheckBox();
        private readonly CheckBox _accept = new CheckBox();
        private readonly LinkLabel _viewLicense = new LinkLabel();
        private readonly Label _status = new Label();
        private readonly ProgressBar _progress = new ProgressBar();
        private readonly Button _install = new Button();
        private readonly Button _cancel = new Button();

        private readonly Label _doneTitle = new Label();
        private readonly Label _donePath = new Label();
        private readonly Label _doneGuide = new Label();
        private readonly CheckBox _launch = new CheckBox();
        private readonly Button _close = new Button();

        private readonly string? _initialLocation;
        private readonly string? _initialProject;
        private readonly string? _initialServer;
        private readonly string? _initialOnline;
        private readonly string? _initialSync;
        private bool _busy;
        private string? _installedExecutable;

        private const int PbmSetBarColor = 0x409;
        private const int PbmSetBackgroundColor = 0x2001;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("uxtheme.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int SetWindowTheme(IntPtr handle, string? subApp, string? subIdList);

        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);

        public SetupForm(string? initialLocation = null, string? initialProject = null, string? initialServer = null, string? initialOnline = null, string? initialSync = null)
        {
            _initialLocation = initialLocation;
            _initialProject = initialProject;
            _initialServer = initialServer;
            _initialOnline = initialOnline;
            _initialSync = initialSync;

            Text = "ENVIS Dashboard Setup";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(820, 850);
            BackColor = Background;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // Default icon.
            }

            BuildBrand();
            BuildOptions();
            BuildDonePanel();
            LoadDefaults();
        }

        private void BuildBrand()
        {
            _brand.SetBounds(0, 0, 260, ClientSize.Height);
            _brand.BackColor = BrandBackground;
            Controls.Add(_brand);

            var edge = new Panel
            {
                BackColor = Color.FromArgb(21, 48, 39),
                Dock = DockStyle.Right,
                Width = 1,
            };
            _brand.Controls.Add(edge);

            _logo.SetBounds(52, 52, 72, 72);
            _logo.SizeMode = PictureBoxSizeMode.Zoom;
            _logo.BackColor = Color.Transparent;
            try
            {
                if (Icon != null) _logo.Image = Icon.ToBitmap();
            }
            catch
            {
                // Decorative.
            }

            _brand.Controls.Add(_logo);

            _brandTitle.Text = "ENVIS";
            _brandTitle.ForeColor = Emerald;
            _brandTitle.Font = new Font("Segoe UI", 26F, FontStyle.Bold, GraphicsUnit.Point);
            _brandTitle.SetBounds(52, 146, 190, 52);
            _brand.Controls.Add(_brandTitle);

            _brandSub.Text = "Dashboard for Windows";
            _brandSub.ForeColor = TextPrimary;
            _brandSub.Font = new Font("Segoe UI", 10.5F, FontStyle.Regular, GraphicsUnit.Point);
            _brandSub.SetBounds(52, 200, 200, 26);
            _brand.Controls.Add(_brandSub);

            _brandRegion.Text = "Environmental Management Bureau\nRegion VII";
            _brandRegion.ForeColor = TextMuted;
            _brandRegion.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _brandRegion.SetBounds(52, 232, 200, 44);
            _brand.Controls.Add(_brandRegion);

            _brandVersion.Text = "Version " + Installer.ProductVersion;
            _brandVersion.ForeColor = TextFaint;
            _brandVersion.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _brandVersion.SetBounds(52, ClientSize.Height - 56, 200, 22);
            _brand.Controls.Add(_brandVersion);
        }

        private void BuildOptions()
        {
            var left = 292;

            _title.Text = Installer.AlreadyInstalled ? "Update ENVIS Dashboard" : "Install ENVIS Dashboard";
            _title.ForeColor = TextPrimary;
            _title.Font = new Font("Segoe UI", 17F, FontStyle.Bold, GraphicsUnit.Point);
            _title.SetBounds(left, 42, 500, 40);
            Controls.Add(_title);

            _subtitle.Text = "This adds a real app window for the dashboard and puts it in your notification area.\n" +
                             "The dashboard services keep running while the window is closed.";
            _subtitle.ForeColor = TextMuted;
            _subtitle.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _subtitle.SetBounds(left, 84, 500, 44);
            Controls.Add(_subtitle);

            BuildSection(_locationLabel, "Install location", left, 140);
            BuildTextBox(_location, left, 164, 380);
            BuildBrowseButton(_browseLocation, left + 390, 163);
            _browseLocation.Click += delegate { BrowseForFolder(_location, "Choose where to install ENVIS Dashboard"); };

            _locationHint.Text = "Installed for this Windows account only, so no administrator rights are needed.";
            _locationHint.ForeColor = TextFaint;
            _locationHint.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _locationHint.SetBounds(left, 198, 500, 20);
            Controls.Add(_locationHint);

            BuildSection(_projectLabel, "Dashboard project folder", left, 232);
            BuildTextBox(_project, left, 256, 380);
            BuildBrowseButton(_browseProject, left + 390, 255);
            _browseProject.Click += delegate { BrowseForFolder(_project, "Choose the ENVIS Dashboard project folder"); };

            _projectHint.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _projectHint.SetBounds(left, 290, 500, 42);
            Controls.Add(_projectHint);

            _project.TextChanged += delegate { ValidateProject(); };

            BuildSection(_serverLabel, "Shared dashboard server (optional)", left, 330);
            BuildTextBox(_server, left, 354, 380);
            _serverHint.Text = "Leave blank to run this dashboard locally. On a colleague's PC enter the host's " +
                               "address, e.g. http://192.168.1.20:5173 — the app then uses the host's data and " +
                               "offline maps, and needs no project folder or Node.js.";
            _serverHint.ForeColor = TextFaint;
            _serverHint.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _serverHint.SetBounds(left, 386, 500, 34);
            Controls.Add(_serverHint);

            BuildSection(_onlineLabel, "Public dashboard URL (optional, internet)", left, 428);
            BuildTextBox(_online, left, 452, 500);
            _onlineHint.Text = "Used when this PC has internet but cannot reach the office host. " +
                               "Example: https://geocheckcentralvisayas-bit.github.io/envis-region-vii — " +
                               "leave blank until that site is deployed.";
            _onlineHint.ForeColor = TextFaint;
            _onlineHint.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _onlineHint.SetBounds(left, 484, 500, 34);
            Controls.Add(_onlineHint);

            BuildSection(_syncLabel, "LAN sync token (optional, client PCs)", left, 524);
            BuildTextBox(_sync, left, 548, 500);
            _syncHint.Text = "Shared secret set on the host as ENVIS_SYNC_TOKEN. Clients need the same value to refresh the offline copy; leave blank on the host itself.";
            _syncHint.ForeColor = TextFaint;
            _syncHint.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _syncHint.SetBounds(left, 580, 500, 32);
            Controls.Add(_syncHint);

            _startMenu.Text = "Add a Start Menu shortcut";
            _startMenu.ForeColor = TextPrimary;
            _startMenu.Checked = true;
            _startMenu.SetBounds(left, 618, 300, 24);
            Controls.Add(_startMenu);

            _desktop.Text = "Add a Desktop shortcut";
            _desktop.ForeColor = TextPrimary;
            _desktop.Checked = true;
            _desktop.SetBounds(left, 646, 300, 24);
            Controls.Add(_desktop);

            _accept.Text = "I accept the terms in the License Agreement";
            _accept.ForeColor = TextPrimary;
            _accept.SetBounds(left, 676, 360, 24);
            _accept.CheckedChanged += delegate { _install.Enabled = _accept.Checked && !_busy; };
            Controls.Add(_accept);

            _viewLicense.Text = "View license";
            _viewLicense.ForeColor = TextMuted;
            _viewLicense.LinkColor = Emerald;
            _viewLicense.ActiveLinkColor = Color.FromArgb(167, 243, 208);
            _viewLicense.VisitedLinkColor = Emerald;
            _viewLicense.LinkBehavior = LinkBehavior.HoverUnderline;
            _viewLicense.SetBounds(left + 366, 679, 110, 20);
            _viewLicense.Click += delegate { ShowLicense(); };
            Controls.Add(_viewLicense);

            _status.Text = "Ready to install.";
            _status.ForeColor = TextMuted;
            _status.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _status.SetBounds(left, 706, 500, 36);
            Controls.Add(_status);

            _progress.SetBounds(left, 748, 500, 6);
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Minimum = 0;
            _progress.Maximum = 100;
            Controls.Add(_progress);

            _install.Text = "Install";
            _install.SetBounds(left + 318, 774, 182, 40);
            _install.FlatStyle = FlatStyle.Flat;
            _install.FlatAppearance.BorderSize = 0;
            _install.BackColor = Emerald;
            _install.ForeColor = Color.FromArgb(3, 20, 15);
            _install.Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
            _install.Cursor = Cursors.Hand;
            _install.Enabled = false;
            _install.Click += async delegate { await InstallAsync(); };
            Controls.Add(_install);

            _cancel.Text = "Cancel";
            _cancel.SetBounds(left + 222, 774, 88, 40);
            _cancel.FlatStyle = FlatStyle.Flat;
            _cancel.FlatAppearance.BorderColor = BorderColor;
            _cancel.BackColor = FieldBackground;
            _cancel.ForeColor = TextMuted;
            _cancel.Click += delegate { Close(); };
            Controls.Add(_cancel);
        }

        private void BuildDonePanel()
        {
            var left = 292;

            _doneTitle.Text = "ENVIS Dashboard is installed.";
            _doneTitle.ForeColor = Emerald;
            _doneTitle.Font = new Font("Segoe UI", 16F, FontStyle.Bold, GraphicsUnit.Point);
            _doneTitle.SetBounds(left, 150, 500, 40);
            _doneTitle.Visible = false;
            Controls.Add(_doneTitle);

            _donePath.ForeColor = TextMuted;
            _donePath.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _donePath.SetBounds(left, 200, 500, 80);
            _donePath.Visible = false;
            Controls.Add(_donePath);

            _doneGuide.ForeColor = TextMuted;
            _doneGuide.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _doneGuide.SetBounds(left, 286, 500, 240);
            _doneGuide.Visible = false;
            Controls.Add(_doneGuide);

            _launch.Text = "Open ENVIS Dashboard now";
            _launch.ForeColor = TextPrimary;
            _launch.Checked = true;
            _launch.SetBounds(left, 536, 400, 24);
            _launch.Visible = false;
            Controls.Add(_launch);

            _close.Text = "Close";
            _close.SetBounds(left + 336, 646, 164, 40);
            _close.FlatStyle = FlatStyle.Flat;
            _close.FlatAppearance.BorderSize = 0;
            _close.BackColor = Emerald;
            _close.ForeColor = Color.FromArgb(3, 20, 15);
            _close.Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
            _close.Cursor = Cursors.Hand;
            _close.Visible = false;
            _close.Click += delegate { Finish(); };
            Controls.Add(_close);
        }

        private void BuildSection(Label label, string text, int left, int top)
        {
            label.Text = text;
            label.ForeColor = TextPrimary;
            label.Font = new Font("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);
            label.SetBounds(left, top, 400, 22);
            Controls.Add(label);
        }

        private void BuildTextBox(TextBox box, int left, int top, int width)
        {
            box.SetBounds(left, top, width, 28);
            box.BorderStyle = BorderStyle.FixedSingle;
            box.BackColor = FieldBackground;
            box.ForeColor = TextPrimary;
            box.Font = new Font("Segoe UI", 9.5F, FontStyle.Regular, GraphicsUnit.Point);
            Controls.Add(box);
        }

        private void BuildBrowseButton(Button button, int left, int top)
        {
            button.Text = "Browse...";
            button.SetBounds(left, top, 112, 29);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = BorderColor;
            button.BackColor = FieldBackground;
            button.ForeColor = TextPrimary;
            button.Cursor = Cursors.Hand;
            Controls.Add(button);
        }

        private void LoadDefaults()
        {
            _location.Text = string.IsNullOrWhiteSpace(_initialLocation)
                ? Installer.DefaultInstallDirectory
                : _initialLocation;

            var project = Installer.ResolveProjectRoot(_initialProject);
            _project.Text = project ?? string.Empty;
            _server.Text = _initialServer ?? string.Empty;
            _online.Text = _initialOnline ?? string.Empty;
            _sync.Text = _initialSync ?? string.Empty;
            ValidateProject();

            if (Installer.AlreadyInstalled)
            {
                _install.Text = "Update";
                _status.Text = "An earlier copy was found and will be replaced. Your dashboard data is not touched.";
            }
        }

        private static bool IsWebAddress(string value)
        {
            return Uri.TryCreate(value, UriKind.Absolute, out var parsed) &&
                   (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps);
        }

        private void ValidateProject()
        {
            var path = _project.Text.Trim();
            if (Installer.IsProjectRoot(path))
            {
                _projectHint.Text = "Found the dashboard project (package.json and scripts\\serve-live.mjs).";
                _projectHint.ForeColor = Color.FromArgb(52, 211, 153);
            }
            else if (path.Length == 0)
            {
                _projectHint.Text = "Choose the folder that contains package.json and the scripts folder " +
                                   "(closing or restarting the app needs it).";
                _projectHint.ForeColor = Color.FromArgb(251, 191, 36);
            }
            else
            {
                _projectHint.Text = "This folder is not the dashboard project: it needs package.json and " +
                                   "scripts\\serve-live.mjs.";
                _projectHint.ForeColor = Color.FromArgb(248, 113, 113);
            }
        }

        private void BrowseForFolder(TextBox target, string description)
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = description;
                dialog.UseDescriptionForTitle = true;
                dialog.ShowNewFolderButton = false;
                try
                {
                    if (target.Text.Length > 0 && Directory.Exists(target.Text)) dialog.SelectedPath = target.Text;
                }
                catch
                {
                    // Ignore an invalid current value.
                }

                if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.SelectedPath;
            }
        }

        private async Task InstallAsync()
        {
            if (_busy) return;

            var location = _location.Text.Trim();
            var project = _project.Text.Trim();
            var server = _server.Text.Trim();
            var online = _online.Text.Trim();
            var sync = _sync.Text.Trim();

            if (location.Length == 0)
            {
                MessageBox.Show(this, "Choose an install folder.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                _location.Focus();
                return;
            }

            if (server.Length > 0 && !IsWebAddress(server))
            {
                MessageBox.Show(
                    this,
                    "The shared server address must look like:\n\nhttp://192.168.1.20:5173",
                    Text,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                _server.Focus();
                return;
            }

            if (online.Length > 0 && !IsWebAddress(online))
            {
                MessageBox.Show(
                    this,
                    "The public dashboard URL must look like:\n\nhttps://example.github.io/envis-region-vii",
                    Text,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                _online.Focus();
                return;
            }

            if (server.Length == 0 && online.Length == 0 && !Installer.IsProjectRoot(project))
            {
                var proceed = MessageBox.Show(
                    this,
                    "The dashboard project folder was not found at:\n\n" +
                    (project.Length == 0 ? "(nothing selected)" : project) +
                    "\n\nThe app needs that folder to start the dashboard. " +
                    "You can install now and point the app at it later with the ENVIS_PROJECT_ROOT setting.\n\nInstall anyway?",
                    "Dashboard project not found",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (proceed != DialogResult.Yes) return;
            }

            _busy = true;
            _install.Enabled = false;
            _cancel.Enabled = false;
            _location.Enabled = false;
            _project.Enabled = false;
            _browseLocation.Enabled = false;
            _browseProject.Enabled = false;
            _server.Enabled = false;
            _online.Enabled = false;
            _sync.Enabled = false;
            _startMenu.Enabled = false;
            _desktop.Enabled = false;
            _accept.Enabled = false;
            _viewLicense.Enabled = false;
            _progress.Value = 0;

            IProgress<InstallProgress> reporter = new Progress<InstallProgress>(update =>
            {
                if (IsDisposed) return;
                _progress.Value = Math.Max(0, Math.Min(100, update.Percent));
                _status.Text = update.Message;
            });

            try
            {
                var startMenu = _startMenu.Checked;
                var desktop = _desktop.Checked;
                await Task.Run(() => Installer.Install(location, project, server, online, sync, startMenu, desktop, reporter.Report));

                _installedExecutable = Installer.InstalledExecutable(Path.GetFullPath(location));
                ShowDone(Path.GetFullPath(location));
            }
            catch (Exception error)
            {
                _busy = false;
                _accept.Enabled = true;
                _viewLicense.Enabled = true;
                _install.Enabled = _accept.Checked;
                _cancel.Enabled = true;
                _location.Enabled = true;
                _project.Enabled = true;
                _browseLocation.Enabled = true;
                _browseProject.Enabled = true;
                _server.Enabled = true;
                _online.Enabled = true;
                _sync.Enabled = true;
                _startMenu.Enabled = true;
                _desktop.Enabled = true;
                _progress.Value = 0;
                _status.Text = "Installation did not finish.";

                MessageBox.Show(
                    this,
                    error.Message,
                    "ENVIS Dashboard Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void ShowLicense()
        {
            using (var dialog = new Form())
            {
                dialog.Text = "ENVIS Dashboard License Agreement";
                dialog.ClientSize = new Size(720, 560);
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.BackColor = Background;
                dialog.ForeColor = TextPrimary;
                dialog.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

                var body = new TextBox();
                body.Multiline = true;
                body.ReadOnly = true;
                body.ScrollBars = ScrollBars.Vertical;
                body.WordWrap = true;
                body.BorderStyle = BorderStyle.None;
                body.BackColor = FieldBackground;
                body.ForeColor = TextPrimary;
                body.Font = new Font("Consolas", 9F, FontStyle.Regular, GraphicsUnit.Point);
                body.Text = Installer.LicenseText.Replace("\r\n", "\n").Replace("\n", Environment.NewLine);
                body.SetBounds(20, 20, 680, 480);
                dialog.Controls.Add(body);

                var close = new Button();
                close.Text = "Close";
                close.DialogResult = DialogResult.OK;
                close.FlatStyle = FlatStyle.Flat;
                close.FlatAppearance.BorderSize = 0;
                close.BackColor = Emerald;
                close.ForeColor = Color.FromArgb(3, 20, 15);
                close.Font = new Font("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);
                close.SetBounds(578, 512, 122, 34);
                dialog.Controls.Add(close);
                dialog.AcceptButton = close;
                dialog.CancelButton = close;

                dialog.ShowDialog(this);
            }
        }

        private void ShowDone(string installDirectory)
        {
            _busy = false;

            _title.Visible = false;
            _subtitle.Visible = false;
            _locationLabel.Visible = false;
            _location.Visible = false;
            _browseLocation.Visible = false;
            _locationHint.Visible = false;
            _projectLabel.Visible = false;
            _project.Visible = false;
            _browseProject.Visible = false;
            _projectHint.Visible = false;
            _serverLabel.Visible = false;
            _server.Visible = false;
            _serverHint.Visible = false;
            _onlineLabel.Visible = false;
            _online.Visible = false;
            _onlineHint.Visible = false;
            _syncLabel.Visible = false;
            _sync.Visible = false;
            _syncHint.Visible = false;
            _startMenu.Visible = false;
            _desktop.Visible = false;
            _accept.Visible = false;
            _viewLicense.Visible = false;
            _status.Visible = false;
            _progress.Visible = false;
            _install.Visible = false;
            _cancel.Visible = false;

            _doneTitle.Visible = true;
            _donePath.Text = "Installed to:\n" + installDirectory +
                             "\n\nOpen it from the Start Menu or the notification area after it starts.";
            _donePath.Visible = true;
            _doneGuide.Text =
                "QUICK START - install and sign in\n\n" +
                "1. Host PC: leave the server field blank. Other PCs: enter the host address\n" +
                "   (for example http://192.168.1.31:5173).\n" +
                "2. Open the app and choose a sign-in tab:\n" +
                "     Online sign in  - your ENVIS username and password.\n" +
                "     Offline password - one password only, no username; works offline.\n" +
                "3. Only MIS can set that password: sign in to the live dashboard as MIS,\n" +
                "   then Administration -> Offline access -> New offline password.\n" +
                "4. The tray icon switches between live and offline at any time.\n" +
                "5. Client PCs need the host's LAN sync token to refresh the offline copy.\n\n" +
                "A full guide is saved as START HERE.txt in the install folder.";
            _doneGuide.Visible = true;
            _launch.Visible = true;
            _close.Visible = true;
            AcceptButton = _close;
        }

        private void Finish()
        {
            var launch = _launch.Checked && _installedExecutable != null;
            Close();

            if (!launch) return;
            try
            {
                Process.Start(new ProcessStartInfo(_installedExecutable!) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "ENVIS Dashboard was installed, but it could not be opened:\n\n" + error.Message,
                    "ENVIS Dashboard Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            ApplyDarkChrome();
        }

        private void ApplyDarkChrome()
        {
            try
            {
                var dark = 1;
                DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));

                // Themed progress bars ignore custom colours, so drop the theme.
                _progress.CreateControl();
                SetWindowTheme(_progress.Handle, string.Empty, string.Empty);
                SendMessage(_progress.Handle, PbmSetBarColor, IntPtr.Zero,
                    (IntPtr)ColorTranslator.ToWin32(Emerald));
                SendMessage(_progress.Handle, PbmSetBackgroundColor, IntPtr.Zero,
                    (IntPtr)ColorTranslator.ToWin32(FieldBackground));
            }
            catch
            {
                // Cosmetic only: a light title bar is still perfectly usable.
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (_busy)
            {
                e.Cancel = true;
                return;
            }

            base.OnFormClosing(e);
        }
    }
}
