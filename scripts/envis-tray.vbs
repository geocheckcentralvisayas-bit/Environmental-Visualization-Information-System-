' Double-click this file to run the ENVIS Dashboard tray controller.
' It starts PowerShell with no console window, so no terminal is shown.
Option Explicit
Dim folder, command, shell
folder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & folder & "envis-tray.ps1"" -Lan"
Set shell = CreateObject("Wscript.Shell")
shell.Run command, 0, False
