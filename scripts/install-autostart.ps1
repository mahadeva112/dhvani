<#
.SYNOPSIS
    Registers (or removes) a Windows scheduled task that starts the DHVANI
    backend at logon.

.DESCRIPTION
    The backend serves the built UI on its own port, so browsing to it directly
    only works while the process is alive. Left to a terminal, it stops the
    moment that terminal closes - and an already-open tab then fails every
    /api call with "Failed to fetch" while still looking fine.

    This registers a per-user logon task so the backend is simply always there.
    It runs as the current user (no elevation, no stored password) and restarts
    itself a few times if it dies.

.PARAMETER Uninstall
    Remove the task instead of creating it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$TaskName = 'DHVANI Backend'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $PSScriptRoot 'start-backend-hidden.vbs'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed the '$TaskName' task. The backend will no longer start at logon." -ForegroundColor Yellow
    }
    else {
        Write-Host "No '$TaskName' task is registered - nothing to remove." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $Launcher)) {
    throw "Launcher not found at $Launcher"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node was not found on PATH. Install Node.js 20+ before registering the task.'
}

# wscript.exe runs the .vbs shim, which in turn starts node with no window.
$Action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$Launcher`"" `
    -WorkingDirectory $Root

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Interactive so it runs in the desktop session; Limited so it never elevates.
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'Starts the DHVANI backend (Express + built UI) at logon.' `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Force | Out-Null

Write-Host "Registered '$TaskName' - the backend now starts at every logon." -ForegroundColor Green
Write-Host "  Logs:      $(Join-Path $Root 'logs\backend.log')"
Write-Host "  Start now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove:    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall"
