# Extra steps for the Windows installer (electron-builder's `nsis.include`).
#
# "Restart and install" runs the installer silently (desktop/main.cjs →
# quitAndInstall), so DHVANI's window closes and nothing would be on screen
# until the new version opens. This puts the "Updating DHVANI" window
# (desktop/update-splash.ps1) up for that stretch and tells it which stage the
# install is at. Only an in-app update gets it: a normal setup run shows the
# full installer instead.
#
# The window closes itself once the new version's window appears, or soon
# after the installer exits if it never does.

!macro dhvaniSplashStage STAGE
  ${if} $dhvaniSplashStatus != ""
    FileOpen $9 $dhvaniSplashStatus w
    FileWrite $9 "${STAGE}"
    FileClose $9
  ${endIf}
!macroend

!macro customInit
  Var /GLOBAL dhvaniSplashStatus
  StrCpy $dhvaniSplashStatus ""
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    InitPluginsDir
    File /oname=$PLUGINSDIR\update-splash.ps1 "${PROJECT_DIR}\desktop\update-splash.ps1"
    File /oname=$PLUGINSDIR\update-splash.png "${PROJECT_DIR}\desktop\icons\icon.png"
    StrCpy $dhvaniSplashStatus "$PLUGINSDIR\update-splash.txt"
    !insertmacro dhvaniSplashStage "closing"

    # The version being replaced, for the "1.2.0 → 1.3.0" line.
    ReadRegStr $1 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    System::Call 'kernel32::GetCurrentProcessId() i .r2'

    # ExecShell returns straight away; SW_HIDE keeps PowerShell's console out
    # of sight (the splash is its own window).
    ExecShell "open" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" \
      '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "$PLUGINSDIR\update-splash.ps1" -StatusFile "$dhvaniSplashStatus" -AppExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}" -Version "${VERSION}" -FromVersion "$1" -Icon "$PLUGINSDIR\update-splash.png" -InstallerPid $2' \
      SW_HIDE
  ${endIf}
!macroend

# Runs right after the new files are unpacked.
!macro dhvaniFilesUnpacked
  !insertmacro dhvaniSplashStage "finishing"
!macroend
!macro customFiles_x64
  !insertmacro dhvaniFilesUnpacked
!macroend
!macro customFiles_arm64
  !insertmacro dhvaniFilesUnpacked
!macroend
!macro customFiles_ia32
  !insertmacro dhvaniFilesUnpacked
!macroend

# The last step before the installer relaunches the app.
!macro customInstall
  !insertmacro dhvaniSplashStage "reopening"
!macroend
