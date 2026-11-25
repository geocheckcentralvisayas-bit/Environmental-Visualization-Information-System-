# ENVIS Dashboard for Windows

A real desktop window for the dashboard, instead of a terminal plus a browser tab.

- Compiled WinForms app hosting the site in **WebView2** (the Edge engine already
  installed on Windows 10/11) — no address bar, no browser chrome.
- Starts the same services as `npm run live:lan`: Vite on `5173`, the Cloudflare
  Worker API on `8787`, the planning watcher on `8788`.
- Lives in the notification area: reopen, restart, stop, status, logs, exit.
- Closing the window keeps the services running, so colleagues on the LAN keep
  working. Use **Exit and stop services** to shut everything down.
- Starts nothing at logon unless you create a shortcut yourself.

## Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1
```

Outputs:

| File | What it is |
| --- | --- |
| `desktop\dist\ENVIS Dashboard.exe` | Portable app, single file, self-contained (~64 MB) |
| `desktop\dist\ENVIS Dashboard Setup.exe` | Installer with the app embedded (~127 MB) |

The first build downloads the `Microsoft.Web.WebView2` package and the .NET 8
runtime pack, so it needs internet once. Later builds are offline.

Useful switches:

```powershell
... desktop\build.ps1 -AppOnly           # portable exe only
... desktop\build.ps1 -SetupOnly         # rebuild the installer from desktop\dist
... desktop\build.ps1 -FrameworkDependent  # ~2 MB app exe, needs .NET 8 Desktop Runtime
```

## Install

Run `desktop\dist\ENVIS Dashboard Setup.exe` and pick:

1. **Install location** — defaults to
   `%LOCALAPPDATA%\Programs\ENVIS Dashboard`. Per-user, so **no administrator
   rights** are needed.
2. **Dashboard project folder** — the folder that contains `package.json` and
   `scripts\serve-live.mjs`. Setup pre-fills it when it can find the project next
   to itself. Only needed on the host PC.
3. **Shared dashboard server (optional)** — on a colleague's PC, enter the host
   address shown in the host's tray → Status, for example
   `http://192.168.1.20:5173`. The app then uses the host's data, API and
   offline map tiles, starts no local services, and needs no Node.js or project
   folder. Leave it blank to run everything on this PC.

It then creates Start Menu and Desktop shortcuts (both optional) and registers
the app in **Settings → Apps → Installed apps** with a working uninstaller.

Silent install, for a script or a second PC:

```powershell
"ENVIS Dashboard Setup.exe" /S `
  /DIR:"C:\Users\me\AppData\Local\Programs\ENVIS Dashboard" `
  /PROJECTROOT:"D:\ENVIS Dashboard"
```

Client PC (no project, no Node.js needed):

```powershell
"ENVIS Dashboard Setup.exe" /S /SERVER:http://192.168.1.20:5173
```

The installer only installs the **window app**. The dashboard itself is this
project (Node services, `node_modules`, worker secrets, planning workbook), so
the host PC must already have the project somewhere; Setup records where. On a
PC where the project lives elsewhere later, either reinstall or set the
`ENVIS_PROJECT_ROOT` environment variable to that folder. `ENVIS_SERVER_URL`
overrides client mode for one run.

The map works without internet because the host serves the bundled
`offline-tiles\` pack (streets + satellite, zoom 7-12, about 23 MB). Once per
project copy, while online:

```powershell
npm run data:tiles
```

Keep `offline-tiles\` with the project when copying it to another PC. Its tiles
still carry the Esri/OpenStreetMap attribution shown on the map.

## Run

Double-click the Start Menu entry, the Desktop shortcut, or
`desktop\dist\ENVIS Dashboard.exe` (portable, no install needed).

The window shows a starting panel while the services boot, then loads the
dashboard. An installed copy reads the project folder from
`%LOCALAPPDATA%\ENVIS Dashboard\config.json`; the portable exe walks up from its
own folder, so keep it inside the project tree (it needs `node_modules`,
`package.json` and `scripts\serve-live.mjs`).

Requirements on the target PC:

1. **Host PC:** Node.js 20+ on `PATH`, the project's `node_modules`,
   `worker\.dev.vars`, `CREDENTIALS.md` and the planning workbook already set up
   (see the main `SETUP_NEW_PC.md`). Run `npm run data:tiles` once for offline
   maps.
2. **Client PC:** only the installer and the host's LAN address — no Node.js,
   no project folder, no internet.
3. **WebView2 runtime** — included with Windows 11 and with Microsoft Edge on
   Windows 10. If missing, install the Evergreen Runtime from Microsoft.

## Tray menu

| Item | Effect |
| --- | --- |
| Open dashboard | Restores the window |
| Restart services | Stops and restarts Vite, the API and the planning watcher, then reloads |
| Stop services | Stops all three; the window shows "Services stopped" |
| Status... | LIVE/DOWN for each port, plus project, Node and log paths |
| Open logs folder | Opens `logs\` in Explorer |
| Exit (keep services running) | Closes the window, LAN users keep working |
| Exit and stop services | Closes everything |

Closing the window with **X** hides it to the tray.

## Logs

- `logs\services.log` — the supervisor, Vite, the API and the planning watcher.
- `logs\desktop-app.log` — app-level notes: start, loaded, failures.

If the dashboard does not appear, `logs\desktop-app.log` says why, and
`logs\services.log` shows whether the services themselves started.

## Notes

- Neither file is **code-signed**. Windows SmartScreen may show
  "Windows protected your PC" the first time: **More info → Run anyway**.
- The app binds the site to all interfaces (like the existing logon task), so
  the LAN address keeps working while the window is open **or** hidden.
- WebView2 stores its profile under
  `%LOCALAPPDATA%\ENVIS Dashboard\WebView2`, so the login cookie survives
  restarts.
- Nothing starts automatically at logon. To do that, put a shortcut to the exe
  in `shell:startup`, or keep using the existing scheduled task
  (`npm run live:lan:autostart`).
- The 127 MB installer size is the .NET runtime plus the app; the app payload is
  already compressed, so the installer cannot get much smaller. Use the portable
  exe where size matters.

## Uninstall

**Installed copy:** Settings → Apps → **ENVIS Dashboard** → Uninstall, or run

```powershell
"%LOCALAPPDATA%\Programs\ENVIS Dashboard\ENVIS Dashboard.exe" --uninstall
... --uninstall --silent     # no prompts
```

It stops the services, removes the shortcuts, the Apps & Features entry and the
saved project location. The project folder, the dashboard data and (unless you
say yes) the WebView2 profile are left alone.

**Portable copy:** Tray → **Exit and stop services**, then delete
`desktop\dist`, `desktop\publish` and `desktop\installer\publish`. Remove
`%LOCALAPPDATA%\ENVIS Dashboard` if you also want the saved login.
