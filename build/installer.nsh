; Included by electron-builder's NSIS installer (package.json build.nsis.include).
;
; Marklore registers itself on request (Settings → System): an "Open with"
; candidate for .md files and a startup entry, all under HKCU and pointing at
; the running Marklore.exe (desktop/integration.mjs). Uninstalling removes the
; entries that point at this installation; an upgrade keeps them, since the
; program stays at the same path. Entries of another copy (a zip version
; elsewhere) are left alone. Notes and settings in %APPDATA%\Marklore are kept.

!macro markloreForgetIfOurs VALUE
  ; True when VALUE starts with "$INSTDIR\Marklore.exe" (quoted).
  StrCpy $R8 '"$INSTDIR\Marklore.exe"'
  StrLen $R9 $R8
  StrCpy $R7 ${VALUE} $R9
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $R6 HKCU "Software\Classes\Marklore.Markdown\shell\open\command" ""
    !insertmacro markloreForgetIfOurs $R6
    ${if} $R7 == $R8
      DeleteRegKey HKCU "Software\Classes\Marklore.Markdown"
      DeleteRegKey HKCU "Software\Marklore\Capabilities"
      DeleteRegKey /ifempty HKCU "Software\Marklore"
      DeleteRegValue HKCU "Software\RegisteredApplications" "Marklore"
      DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "Marklore.Markdown"
      DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "Marklore.Markdown"
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
    ${endIf}

    ReadRegStr $R6 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Marklore"
    !insertmacro markloreForgetIfOurs $R6
    ${if} $R7 == $R8
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Marklore"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Marklore"
    ${endIf}
  ${endIf}
!macroend
