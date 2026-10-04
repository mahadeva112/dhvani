# Extra steps for the Windows installer (electron-builder's `nsis.include`).
#
# "Restart and install" runs the installer silently (desktop/main.cjs →
# quitAndInstall), so DHVANI's window closes and nothing would be on screen
# until the new version opens. This puts a small "Updating DHVANI" window up
# for that stretch. Only an in-app update gets it: a normal setup run shows
# the full installer instead.

!macro customInit
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    # Banner's box is small and shows one line; longer text is cut off.
    Banner::show "Updating ${PRODUCT_NAME} to ${VERSION}..."
    # Keep it above other windows (HWND_TOPMOST; SWP_NOSIZE|NOMOVE|NOACTIVATE),
    # or whatever the user switches to buries it.
    Banner::getWindow
    Pop $0
    System::Call 'user32::SetWindowPos(p r0, p -1, i 0, i 0, i 0, i 0, i 0x13)'
  ${endIf}
!macroend

# The last step before the installer relaunches the app.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    Banner::destroy
  ${endIf}
!macroend
