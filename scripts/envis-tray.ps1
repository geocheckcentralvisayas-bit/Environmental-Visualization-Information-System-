# ENVIS Dashboard system-tray controller.
#
# Runs with no console window (launch via envis-tray.vbs or -WindowStyle Hidden).
# Right-click the tray icon to open, restart, stop or check the local services.
param([switch]$Lan)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dashboardUrl = if ($Lan) { 'http://192.168.190.21:5173' } else { 'http://localhost:5173' }
$liveScript = Join-Path $root 'scripts\live.ps1'
$lanArg = if ($Lan) { ' -Lan' } else { '' }

function Invoke-Live([string]$Action) {
    $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$liveScript`" -Action $Action$lanArg"
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Wait
}

function Stop-EnvisServices {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'serve-live\.mjs|vite|wrangler|planning-service\.mjs|ensure-api' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($port in 5173, 8787, 8788) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}

function Get-ServiceStatus {
    $lines = foreach ($port in 5173, 8787, 8788) {
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        $label = switch ($port) {
            5173 { 'Dashboard' }
            8787 { 'API' }
            8788 { 'Planning watcher' }
        }
        '{0,-18} port {1,-5} {2}' -f $label, $port, $(if ($listener) { 'LIVE' } else { 'DOWN' })
    }
    [System.Windows.Forms.MessageBox]::Show(($lines -join "`n"), 'ENVIS Dashboard status', 'OK', 'Information')
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = "ENVIS Dashboard - $dashboardUrl"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Open dashboard')
$openItem.Add_Click({ Start-Process $dashboardUrl })

$restartItem = $menu.Items.Add('Restart services')
$restartItem.Add_Click({ Invoke-Live 'restart' })

$stopItem = $menu.Items.Add('Stop services')
$stopItem.Add_Click({ Stop-EnvisServices })

$statusItem = $menu.Items.Add('Status...')
$statusItem.Add_Click({ Get-ServiceStatus })

$menu.Items.Add('-')

$exitItem = $menu.Items.Add('Exit tray controller')
$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Start-Process $dashboardUrl })

# Keep the message loop alive without showing a window.
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.WindowState = 'Minimized'
$form.ShowInTaskbar = $false
$form.Opacity = 0

$exitItem.Add_Click({
    $notify.Visible = $false
    $notify.Dispose()
    $form.Close()
    [System.Windows.Forms.Application]::ExitThread()
})

try {
    $notify.ShowBalloonTip(3000, 'ENVIS Dashboard', 'Tray controller ready. Right-click for options.', [System.Windows.Forms.ToolTipIcon]::Info)
} catch {
    # Balloon tips can be disabled on this machine; harmless.
}

[System.Windows.Forms.Application]::Run($form)
