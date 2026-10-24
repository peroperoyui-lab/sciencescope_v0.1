; Tauri already provides an unchecked "delete application data" checkbox.
; Its default directories are AppData; ScienceScope keeps data next to the exe.
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

Var ScienceScopeWarnings
Var ScienceScopeHardFailure
Var ScienceScopeBuild
Var ScienceScopeX64
Var ScienceScopeAvx2
Var ScienceScopeMemory
Var ScienceScopeFree
Var ScienceScopeQuiet
Var ScienceScopeLog

!macro ScienceScopeMinimumRequirements
  StrCpy $ScienceScopeWarnings ""
  StrCpy $ScienceScopeHardFailure ""
  StrCpy $ScienceScopeQuiet 0
  IfSilent 0 +2
    StrCpy $ScienceScopeQuiet 1
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    StrCpy $ScienceScopeQuiet 1
  ${EndIf}
  ReadRegStr $ScienceScopeBuild HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  StrCpy $ScienceScopeX64 0
  ${If} ${IsNativeAMD64}
    StrCpy $ScienceScopeX64 1
  ${EndIf}
  System::Call 'kernel32::IsProcessorFeaturePresent(i 40)i.s'
  Pop $ScienceScopeAvx2
  System::Alloc 64
  Pop $R0
  System::Call '*$R0(i 64)'
  System::Call 'kernel32::GlobalMemoryStatusEx(p R0)i.R1'
  System::Call '*$R0(i, i, l .R2)'
  System::Free $R0
  System::Int64Op $R2 / 1048576
  Pop $ScienceScopeMemory
  ${GetRoot} "$INSTDIR" $R0
  ${DriveSpace} "$R0\" "/D=F /S=M" $ScienceScopeFree

  ; Only an explicitly branded rehearsal build accepts simulation parameters.
  !ifdef SCIENCESCOPE_INSTALL_TEST
    !if "${PRODUCTNAME}" != "ScienceScope Install Test"
      !error "Hardware simulation is only allowed in ScienceScope Install Test"
    !endif
    ClearErrors
    ${GetOptions} $CMDLINE "/SCIENCESCOPE_TEST_BUILD=" $R0
    ${Unless} ${Errors}
      StrCpy $ScienceScopeBuild $R0
    ${EndUnless}
    ClearErrors
    ${GetOptions} $CMDLINE "/SCIENCESCOPE_TEST_X64=" $R0
    ${Unless} ${Errors}
      StrCpy $ScienceScopeX64 $R0
    ${EndUnless}
    ClearErrors
    ${GetOptions} $CMDLINE "/SCIENCESCOPE_TEST_AVX2=" $R0
    ${Unless} ${Errors}
      StrCpy $ScienceScopeAvx2 $R0
    ${EndUnless}
    ClearErrors
    ${GetOptions} $CMDLINE "/SCIENCESCOPE_TEST_MEMORY=" $R0
    ${Unless} ${Errors}
      StrCpy $ScienceScopeMemory $R0
    ${EndUnless}
    ClearErrors
    ${GetOptions} $CMDLINE "/SCIENCESCOPE_TEST_FREE=" $R0
    ${Unless} ${Errors}
      StrCpy $ScienceScopeFree $R0
    ${EndUnless}
  !endif

  ${If} $ScienceScopeBuild < 19045
  ${OrIf} $ScienceScopeX64 <> 1
    ${If} $LANGUAGE = 2052
      StrCpy $ScienceScopeHardFailure "需要 Windows 10 22H2（内部版本 19045）或更新的 x64 系统。当前 Windows 内部版本：$ScienceScopeBuild；x64：$ScienceScopeX64。无法安装。"
    ${Else}
      StrCpy $ScienceScopeHardFailure "Windows 10 22H2 (build 19045) or later on x64 is required. Current Windows build: $ScienceScopeBuild; x64: $ScienceScopeX64. Installation cannot continue."
    ${EndIf}
  ${EndIf}
  ${If} $ScienceScopeAvx2 <> 1
    ${If} $LANGUAGE = 2052
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- 处理器不支持 AVX2：向量检索关闭，只能按关键词检索。"
    ${Else}
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- The processor does not support AVX2: vector search is disabled; keyword search remains available."
    ${EndIf}
  ${EndIf}
  ${If} $ScienceScopeMemory < 8192
    ${If} $LANGUAGE = 2052
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- 内存低于 8 GiB（当前 $ScienceScopeMemory MiB）：向量检索关闭，只能按关键词检索。"
    ${Else}
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- Memory is below 8 GiB (currently $ScienceScopeMemory MiB): vector search is disabled; keyword search remains available."
    ${EndIf}
  ${EndIf}
  ${If} $ScienceScopeFree < 5120
    ${If} $LANGUAGE = 2052
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- 安装盘空闲低于 5 GiB（当前 $ScienceScopeFree MiB）：资料和 Python 环境可能装不下。"
    ${Else}
      StrCpy $ScienceScopeWarnings "$ScienceScopeWarnings$\r$\n- The installation drive has less than 5 GiB free (currently $ScienceScopeFree MiB): research files and Python environments may not fit."
    ${EndIf}
  ${EndIf}
  DetailPrint "ScienceScope requirements: build=$ScienceScopeBuild x64=$ScienceScopeX64 AVX2=$ScienceScopeAvx2 memoryMiB=$ScienceScopeMemory freeMiB=$ScienceScopeFree"
  FileOpen $ScienceScopeLog "$TEMP\${PRODUCTNAME}-install-check.log" a
  FileWrite $ScienceScopeLog "build=$ScienceScopeBuild x64=$ScienceScopeX64 AVX2=$ScienceScopeAvx2 memoryMiB=$ScienceScopeMemory freeMiB=$ScienceScopeFree quiet=$ScienceScopeQuiet$\r$\n$ScienceScopeHardFailure$ScienceScopeWarnings$\r$\n"
  FileClose $ScienceScopeLog
  ${If} $ScienceScopeHardFailure != ""
    DetailPrint "$ScienceScopeHardFailure"
    ${If} $ScienceScopeQuiet <> 1
      MessageBox MB_OK|MB_ICONSTOP "$ScienceScopeHardFailure" /SD IDOK
    ${EndIf}
    SetErrorLevel 1633
    Quit
  ${EndIf}
  ${If} $ScienceScopeWarnings != ""
    DetailPrint "$ScienceScopeWarnings"
    ${If} $ScienceScopeQuiet <> 1
      ${If} $LANGUAGE = 2052
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "本机部分配置低于建议值：$\r$\n$ScienceScopeWarnings$\r$\n$\r$\n是否继续安装？" /SD IDCANCEL IDOK ScienceScopeRequirementsContinue
      ${Else}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Some system requirements are not met:$\r$\n$ScienceScopeWarnings$\r$\n$\r$\nContinue installing?" /SD IDCANCEL IDOK ScienceScopeRequirementsContinue
      ${EndIf}
      SetErrorLevel 1602
      Quit
    ${EndIf}
  ${EndIf}
  ScienceScopeRequirementsContinue:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
