# Extra steps for the Windows installer (electron-builder's `nsis.include`).
#
# "Restart and install" runs the installer silently (desktop/main.cjs →
# quitAndInstall), so DHVANI's window closes and nothing would be on screen
# until the new version opens. This puts the "Installing DHVANI" window
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
    StrCpy $dhvaniSplashStatus "$PLUGINSDIR\update-splash.txt"
    !insertmacro dhvaniSplashStage "closing"

    # The version being replaced, for the "Installed 1.3.0 · New 1.3.1" line.
    ReadRegStr $1 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    System::Call 'kernel32::GetCurrentProcessId() i .r2'
    # The installed copy, so the window can tell when the old app has closed
    # and the new one is up. $INSTDIR isn't settled yet this early (the
    # assisted installer sets it in the install section), so read where the
    # last install went.
    ReadRegStr $8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $8 == ""
      ReadRegStr $8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${endIf}
    ${if} $8 == ""
      StrCpy $8 $INSTDIR
    ${endIf}
    # The installer is 32-bit, so $SYSDIR is SysWOW64; Sysnative reaches the
    # 64-bit PowerShell, which can see the (64-bit) app's processes properly.
    StrCpy $9 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${ifNot} ${FileExists} $9
      StrCpy $9 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${endIf}
    StrCpy $5 '"$9" -NoProfile -ExecutionPolicy Bypass -STA -File "$PLUGINSDIR\update-splash.ps1" -StatusFile "$dhvaniSplashStatus" -AppExe "$8\${APP_EXECUTABLE_FILENAME}" -Version "${VERSION}" -FromVersion "$1" -InstallerPid $2'

    # CreateProcess with CREATE_NO_WINDOW, so PowerShell gets no console at
    # all. ExecShell with SW_HIDE isn't enough: where Windows Terminal is the
    # default terminal, it opens a visible terminal window regardless.
    # STARTUPINFOW and PROCESS_INFORMATION are 68 and 16 bytes (32-bit NSIS).
    System::Alloc 68
    Pop $3
    System::Call '*$3(i 68)'
    System::Alloc 16
    Pop $4
    System::Call 'kernel32::CreateProcessW(p 0, w r5, p 0, p 0, i 0, i 0x08000000, p 0, p 0, p r3, p r4) i .r0'
    ${if} $0 != 0
      System::Call '*$4(p .r6, p .r7)'
      System::Call 'kernel32::CloseHandle(p r6)'
      System::Call 'kernel32::CloseHandle(p r7)'
    ${endIf}
    System::Free $3
    System::Free $4
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
