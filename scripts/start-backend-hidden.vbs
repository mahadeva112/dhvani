' Launches the DHVANI backend with no console window.
'
' Windows shows a console window for node.exe even when a scheduled task is
' marked hidden, so the task runs this shim instead: WScript.Shell.Run with a
' window style of 0 is the only reliable way to keep it off screen.
'
' Output is appended to logs\backend.log - without it a backend that fails to
' start would vanish silently, which is exactly the failure this is meant to
' prevent.

Option Explicit

Dim shell, fso, root, logDir, logFile, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' This script lives in <root>\scripts, so the app root is two levels up.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

logDir = fso.BuildPath(root, "logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = fso.BuildPath(logDir, "backend.log")

shell.CurrentDirectory = root

' cmd /c is needed for the redirection; the 0 keeps every window hidden.
command = "cmd /c node server\index.js >> """ & logFile & """ 2>&1"

shell.Run command, 0, False
