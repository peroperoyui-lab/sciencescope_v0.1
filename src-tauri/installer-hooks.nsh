; Tauri already provides an unchecked "delete application data" checkbox.
; Its default directories are AppData; ScienceScope keeps data next to the exe.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
