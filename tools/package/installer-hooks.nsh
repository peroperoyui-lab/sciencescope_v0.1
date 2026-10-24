; Keep the existing opt-in data deletion for uninstall, separate from upgrades.
!include "${__FILEDIR__}\..\..\src-tauri\installer-hooks.nsh"
!define SCIENCESCOPE_CLEANUP_SCRIPT "${__FILEDIR__}\cleanup-program.ps1"

Var ScienceScopePhaseTime
Var ScienceScopePhaseLog
Var ScienceScopeCleanupResult
Var ScienceScopeCleanupOutput

!macro ScienceScopeInstallPhase phase
  System::Call 'kernel32::GetTickCount64() l .s'
  Pop $ScienceScopePhaseTime
  FileOpen $ScienceScopePhaseLog "$TEMP\${PRODUCTNAME}-install-phases.log" a
  FileSeek $ScienceScopePhaseLog 0 END
  FileWrite $ScienceScopePhaseLog "${phase} $ScienceScopePhaseTime$\r$\n"
  FileClose $ScienceScopePhaseLog
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ScienceScopeInstallPhase "preinstall"
  !insertmacro ScienceScopeMinimumRequirements
  ; An empty/new destination must not be treated as an old installation.
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 ScienceScopeCleanupDone
  ; Tauri normally checks after this hook: do it before changing program files.
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; A hash set keeps manifest comparison linear. PowerShell uses the platform's
  ; existing .NET file APIs, so cleanup does not depend on a working old runtime.
  InitPluginsDir
  File /oname=$PLUGINSDIR\cleanup-program.ps1 "${SCIENCESCOPE_CLEANUP_SCRIPT}"
  File /oname=$PLUGINSDIR\program-files.txt "${SCIENCESCOPE_PROGRAM_MANIFEST}"
  !insertmacro ScienceScopeInstallPhase "cleanup-start"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-program.ps1" -InstallRoot "$INSTDIR" -Manifest "$PLUGINSDIR\program-files.txt" -MainBinary "${MAINBINARYNAME}.exe" -TimingLog "$TEMP\${PRODUCTNAME}-cleanup.json"'
  Pop $ScienceScopeCleanupResult
  Pop $ScienceScopeCleanupOutput
  !insertmacro ScienceScopeInstallPhase "cleanup-end"
  StrCmp $ScienceScopeCleanupResult "0" ScienceScopeCleanupDone
    DetailPrint "$ScienceScopeCleanupOutput"
    SetErrorLevel 1
    ${If} $LANGUAGE = 2052
      MessageBox MB_OK|MB_ICONSTOP "无法清理旧程序文件。请关闭 ScienceScope 后重新安装。" /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "Could not remove old program files. Close ScienceScope and run the installer again." /SD IDOK
    ${EndIf}
    Abort
  ScienceScopeCleanupDone:
  !insertmacro ScienceScopeInstallPhase "write-start"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro ScienceScopeInstallPhase "postinstall"
!macroend
