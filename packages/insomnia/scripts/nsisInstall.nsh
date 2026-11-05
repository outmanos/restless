!include nsDialogs.nsh

!macro customPageAfterChangeDir
  Var AllowAutomaticUpdates
  Var AllowAutomaticUpdatesCheckbox

  Function automaticUpdatesPageCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
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

  Page custom automaticUpdatesPageCreate automaticUpdatesPageLeave
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
