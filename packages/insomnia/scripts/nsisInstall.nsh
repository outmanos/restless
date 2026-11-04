!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  Var AllowAutomaticUpdates
  Var AllowAutomaticUpdatesCheckbox

  Function automaticUpdatesPageCreate
    !insertmacro MUI_HEADER_TEXT "Updates" "Choose how Restless stays up to date."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "Restless makes no network requests when it starts unless you allow this. You can change it later in Preferences."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "Allow Automatic Updates"
    Pop $AllowAutomaticUpdatesCheckbox
    nsDialogs::Show
  FunctionEnd

  Function automaticUpdatesPageLeave
    ${NSD_GetState} $AllowAutomaticUpdatesCheckbox $AllowAutomaticUpdates
  FunctionEnd
!endif

!macro customPageAfterChangeDir
  Page custom automaticUpdatesPageCreate automaticUpdatesPageLeave
!macroend

!macro customInit
  ${ifNot} ${isUpdated}
    StrCpy $0 "$PROFILE\AppData\Local\insomnia\Update.exe"
    StrCpy $1 "$PROFILE\AppData\Local\insomnia\.dead"
    IfFileExists $1 skip_uninstall
    IfFileExists $0 0 skip_uninstall
    MessageBox MB_YESNO "Existing Insomnia installation found, which must be uninstalled first.$\n$\nClick 'No' to exit this installer so you can uninstall yourself.$\n$\nClick 'Yes' to allow this installer to uninstall for you (your existing Insomnia data will be preserved)." IDYES do_uninstall IDNO exit_installer
    do_uninstall:
      nsExec::Exec '"$0" --uninstall -s'
      Goto skip_uninstall
    exit_installer:
      Quit
    skip_uninstall:
  ${endIf}
!macroend

!macro customInstall
  SetOutPath "$INSTDIR"
  DetailPrint "Creating installer-info.json..."

  FileOpen $0 "$INSTDIR\installer-info.json" w
  ${If} $AllowAutomaticUpdates == ${BST_CHECKED}
    FileWrite $0 '{"installer": "nsis", "allowAutomaticUpdates": true}'
  ${Else}
    FileWrite $0 '{"installer": "nsis"}'
  ${EndIf}
  FileClose $0
!macroend
