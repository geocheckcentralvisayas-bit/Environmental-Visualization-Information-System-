using System;
using System.Threading;
using System.Windows.Forms;

namespace EnvisDashboard
{
    internal static class Program
    {
        private const string MutexName = @"Global\EnvisDashboard.SingleInstance";
        private const string ShowEventName = @"Global\EnvisDashboard.ShowWindow";

        [STAThread]
        private static void Main(string[] args)
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (Has(args, "--uninstall"))
            {
                Uninstaller.Run(Has(args, "--silent"));
                return;
            }

            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    SignalExistingInstance();
                    return;
                }

                using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName))
                {
                    Application.Run(new MainForm(showEvent));
                }
            }
        }

        private static bool Has(string[] args, string value)
        {
            foreach (var argument in args)
            {
                if (string.Equals(argument, value, StringComparison.OrdinalIgnoreCase)) return true;
            }

            return false;
        }

        private static void SignalExistingInstance()
        {
            EventWaitHandle? handle;
            if (EventWaitHandle.TryOpenExisting(ShowEventName, out handle) && handle != null)
            {
                using (handle)
                {
                    handle.Set();
                }

                return;
            }

            MessageBox.Show(
                "ENVIS Dashboard is already running. Look for its icon in the notification area.",
                "ENVIS Dashboard",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }
}
