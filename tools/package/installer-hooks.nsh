; Keep the existing opt-in data deletion for uninstall, separate from upgrades.
!include "${__FILEDIR__}\..\..\src-tauri\installer-hooks.nsh"

!macro ScienceScopeRemoveDirectory name
  ${If} ${FileExists} "$INSTDIR\${name}"
    ClearErrors
    RMDir /r "$INSTDIR\${name}"
    IfErrors ScienceScopeCleanupFailed
  ${EndIf}
!macroend

!macro ScienceScopeRemoveFile name
  ${If} ${FileExists} "$INSTDIR\${name}"
    ClearErrors
    Delete "$INSTDIR\${name}"
    IfErrors ScienceScopeCleanupFailed
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ScienceScopeMinimumRequirements
  ; An empty/new destination must not be treated as an old installation.
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 ScienceScopeCleanupDone
  ; Tauri normally checks after this hook: do it before removing any program files.
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Explicit installer-owned paths only. Never remove $INSTDIR itself, data,
  ; or other user files. Keep the executable until last so a failed cleanup
  ; remains identifiable as an old installation when the user retries.
  !insertmacro ScienceScopeRemoveDirectory "app"
  !insertmacro ScienceScopeRemoveDirectory "node_modules"
  !insertmacro ScienceScopeRemoveDirectory "runtime"
  !insertmacro ScienceScopeRemoveDirectory "python"
  !insertmacro ScienceScopeRemoveDirectory "models"
  !insertmacro ScienceScopeRemoveDirectory "reference"
  !insertmacro ScienceScopeRemoveFile "package.json"
  !insertmacro ScienceScopeRemoveFile "LICENSE"
  !insertmacro ScienceScopeRemoveFile "THIRD_PARTY_NOTICES"
  !insertmacro ScienceScopeRemoveFile "${MAINBINARYNAME}.exe"
  Goto ScienceScopeCleanupDone

  ScienceScopeCleanupFailed:
    SetErrorLevel 1
    ${If} $LANGUAGE = 2052
      MessageBox MB_OK|MB_ICONSTOP "无法清理旧程序文件。请关闭 ScienceScope 后重新安装。" /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "Could not remove old program files. Close ScienceScope and run the installer again." /SD IDOK
    ${EndIf}
    Abort
  ScienceScopeCleanupDone:
!macroend
