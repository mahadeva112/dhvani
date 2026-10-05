# Extra steps for the Windows installer (electron-builder's `nsis.include`).
#
# "Restart and install" runs the installer silently (desktop/main.cjs ->
# quitAndInstall), so DHVANI's window closes and nothing would be on screen
# until the new version opens. This puts a small native "Updating DHVANI" box
# (desktop/update-splash.cs) up for that stretch and tells it which stage the
# install is at. Only an in-app update gets it: a normal setup run shows the
# full installer instead.
#
# The box closes itself once the new version's window appears, or soon after
# the installer exits if it never does.

# Build the box with the C# compiler every Windows has (.NET Framework 4), so
# no binary lives in the repo. A winexe has no console window.
!ifndef BUILD_UNINSTALLER
  !tempfile DHVANI_SPLASH_TMP
  !delfile "${DHVANI_SPLASH_TMP}"
  !define DHVANI_SPLASH_EXE "${DHVANI_SPLASH_TMP}.exe"
  !execute '"$%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /platform:anycpu "/out:${DHVANI_SPLASH_EXE}" "/resource:${PROJECT_DIR}\desktop\icons\icon.png,icon.png" "${PROJECT_DIR}\desktop\update-splash.cs"' = 0
!endif

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
    # A fixed path in %TEMP%, not $PLUGINSDIR: the installer can't delete the
    # box's exe while it runs, so each update reuses this one file rather than
    # leaving another temp folder behind. "try" skips the copy if an earlier
    # box is somehow still open.
    StrCpy $7 "$TEMP\dhvani-update-splash.exe"
    SetOverwrite try
    File /oname=$7 "${DHVANI_SPLASH_EXE}"
    SetOverwrite on
    StrCpy $dhvaniSplashStatus "$PLUGINSDIR\update-splash.txt"
    !insertmacro dhvaniSplashStage "closing"

    # The version being replaced, for the "1.3.3 -> 1.3.4" line.
    ReadRegStr $1 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    System::Call 'kernel32::GetCurrentProcessId() i .r2'
    # The installed copy, so the box can tell when the old app has closed and
    # the new one is up. $INSTDIR isn't settled yet this early (the assisted
    # installer sets it in the install section), so read where the last
    # install went.
    ReadRegStr $8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $8 == ""
      ReadRegStr $8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${endIf}
    ${if} $8 == ""
      StrCpy $8 $INSTDIR
    ${endIf}
    # Exec returns straight away. The box is a GUI program, so no console.
    Exec '"$7" "$dhvaniSplashStatus" "$8\${APP_EXECUTABLE_FILENAME}" "${VERSION}" "$1" $2'
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
