using System;
using System.IO;
using System.Windows.Forms;

namespace EnvisSetup
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (HasFlag(args, "/?") || HasFlag(args, "/HELP") || HasFlag(args, "--help"))
            {
                MessageBox.Show(
                    "ENVIS Dashboard Setup\n\n" +
                    "Usage:\n" +
                    "  ENVIS Dashboard Setup.exe            interactive install\n" +
                    "  ... /S                              silent install with defaults\n" +
                    "  ... /DIR:\"C:\\path\"                   install folder\n" +
                    "  ... /PROJECTROOT:\"C:\\path\"           dashboard project folder\n" +
                    "  ... /SERVER:http://192.168.1.20:5173  connect to the host PC instead\n\n" +
                    "Silent install writes a log to %TEMP%\\envis-setup.log on failure.",
                    "ENVIS Dashboard Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            var silent = HasFlag(args, "/S") || HasFlag(args, "/SILENT") || HasFlag(args, "--silent");
            if (silent)
            {
                var location = GetOption(args, "/DIR:") ?? Installer.DefaultInstallDirectory;
                var project = GetOption(args, "/PROJECTROOT:");
                var server = GetOption(args, "/SERVER:");
                Environment.ExitCode = Installer.RunSilent(location, project, server, true, true);
                return;
            }

            // A visible install path override is useful for shortcuts and scripts.
            var initialLocation = GetOption(args, "/DIR:");
            var initialProject = GetOption(args, "/PROJECTROOT:");
            var initialServer = GetOption(args, "/SERVER:");

            Application.Run(new SetupForm(initialLocation, initialProject, initialServer));
        }

        private static bool HasFlag(string[] args, string value)
        {
            foreach (var argument in args)
            {
                if (string.Equals(argument, value, StringComparison.OrdinalIgnoreCase)) return true;
            }

            return false;
        }

        private static string? GetOption(string[] args, string prefix)
        {
            foreach (var argument in args)
            {
                if (!argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                var value = argument.Substring(prefix.Length).Trim();
                if (value.Length >= 2 && value.StartsWith("\"") && value.EndsWith("\""))
                {
                    value = value.Substring(1, value.Length - 2);
                }

                return value.Length == 0 ? null : value;
            }

            return null;
        }
    }
}
