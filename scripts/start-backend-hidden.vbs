' Launches the DHVANI backend with no console window, and keeps it running.
'
' Windows shows a console window for node.exe even when a scheduled task is
' marked hidden, so the task runs this shim instead: WScript.Shell.Run with a
' window style of 0 is the only reliable way to keep it off screen.
'
' Output is appended to logs\backend.log - without it a backend that fails to
' start would vanish silently, which is exactly the failure this is meant to
' prevent.
'
' This script is also the backend's watchdog. It waits on node, and when node
' stops for any reason (crash, End task, a tool killing node.exe) it starts it
' again a few seconds later and notes that in logs\watchdog.log. A node that
' is still running but has stopped answering /api/health for about a minute is
' ended and restarted the same way. While something else already serves the
' port it only waits, so it never fights a backend that was
' started another way. To stop the backend for good, stop the watchdog first:
'   Stop-ScheduledTask -TaskName "DHVANI Backend"
' and then end node.

Option Explicit

Dim shell, fso, root, logDir, logFile, watchdogLog, command, port
Dim stopReason, startedAt, delay, wasWaiting

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' This script lives in <root>\scripts, so the app root is two levels up.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

logDir = fso.BuildPath(root, "logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = fso.BuildPath(logDir, "backend.log")
' Its own file: node keeps backend.log open, so lines written there were lost.
watchdogLog = fso.BuildPath(logDir, "watchdog.log")

shell.CurrentDirectory = root
port = ReadPort()

' cmd /c is needed for the redirection; the 0 keeps every window hidden.
command = "cmd /c node server\index.js >> """ & logFile & """ 2>&1"

delay = 3
wasWaiting = False

Do
  If PortInUse() Then
    ' Another backend (a manual start, an older launcher) has the port.
    If Not wasWaiting Then LogLine "Port " & port & " is already served - watching it."
    wasWaiting = True
    WScript.Sleep 5000
  Else
    If wasWaiting Then LogLine "Nothing serves port " & port & " any more - starting the backend."
    wasWaiting = False

    startedAt = Timer
    shell.Run command, 0, False
    stopReason = WatchBackend()

    ' Back off when node dies right after starting (bad build, port race),
    ' so a broken backend doesn't restart in a tight loop.
    If Elapsed(startedAt) < 30 Then
      delay = delay * 2
      If delay > 60 Then delay = 60
    Else
      delay = 3
    End If

    LogLine "Backend " & stopReason & " - restarting in " & delay & " s."
    WScript.Sleep delay * 1000
  End If
Loop

' Waits while the backend runs. Returns when node is gone, or after ending a
' node that is alive but no longer answering (a frozen event loop keeps the
' port open, so waiting for the exit alone never notices it).
Function WatchBackend()
  Dim misses, started
  misses = 0
  started = False
  WScript.Sleep 5000
  Do
    If Not NodeRunning(False) Then
      WatchBackend = "stopped"
      Exit Function
    End If
    If Elapsed(startedAt) > 30 Then started = True
    If started Then
      If Answers() Then
        misses = 0
      Else
        misses = misses + 1
        If misses >= 6 Then
          LogLine "Backend stopped answering for about a minute - ending it."
          NodeRunning True
          WatchBackend = "was ended"
          Exit Function
        End If
      End If
    End If
    WScript.Sleep 10000
  Loop
End Function

' True while this app's node.exe exists; kill = True ends it as well.
Function NodeRunning(kill)
  Dim p, found
  found = False
  On Error Resume Next
  For Each p In GetObject("winmgmts:").ExecQuery("Select * from Win32_Process where Name='node.exe'")
    If InStr(LCase(p.CommandLine), "server\index.js") > 0 Then
      found = True
      If kill Then p.Terminate
    End If
  Next
  On Error GoTo 0
  NodeRunning = found
End Function

' True when /api/health replies within a few seconds.
Function Answers()
  Dim http
  Answers = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 3000, 3000, 5000, 5000
  http.open "GET", "http://127.0.0.1:" & port & "/api/health", False
  http.send
  If Err.Number = 0 Then Answers = (http.status = 200)
  On Error GoTo 0
End Function

' PORT from .env, as the server reads it; 8787 otherwise.
Function ReadPort()
  Dim envFile, f, line
  ReadPort = "8787"
  envFile = fso.BuildPath(root, ".env")
  If Not fso.FileExists(envFile) Then Exit Function
  Set f = fso.OpenTextFile(envFile, 1)
  Do Until f.AtEndOfStream
    line = Trim(f.ReadLine)
    If Left(line, 5) = "PORT=" Then
      If IsNumeric(Mid(line, 6)) Then ReadPort = Mid(line, 6)
    End If
  Loop
  f.Close
End Function

' True while some process listens on the backend's port.
Function PortInUse()
  PortInUse = (shell.Run("cmd /c netstat -an -p tcp | findstr /r /c:"":" & port & " .*LISTENING""", 0, True) = 0)
End Function

' Seconds since a Timer reading, across midnight too.
Function Elapsed(since)
  Dim seconds
  seconds = Timer - since
  If seconds < 0 Then seconds = seconds + 86400
  Elapsed = seconds
End Function

' A missed line is fine, but should not stop the watchdog.
Sub LogLine(message)
  Dim f, stamp
  stamp = Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & " " & _
    Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2)
  On Error Resume Next
  Set f = fso.OpenTextFile(watchdogLog, 8, True)
  f.WriteLine "[" & stamp & "] WATCHDOG " & message
  f.Close
  On Error GoTo 0
End Sub
