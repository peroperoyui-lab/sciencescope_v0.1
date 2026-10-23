param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskLocal = Join-Path $taskRoot '.sciencescope-local'
$env:CARGO_HOME = Join-Path $taskLocal 'cache/cargo'
$env:RUSTUP_HOME = Join-Path $taskLocal 'runtimes/rustup'
$env:CARGO_TARGET_DIR = Join-Path $taskLocal 'build/tauri'
$env:TEMP = Join-Path $taskLocal 'temp'; $env:TMP = $env:TEMP
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$taskVs = & $taskVswhere -products '*' -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $taskVs) { throw 'Install Visual Studio C++ Build Tools before packaging.' }
$taskDev = Join-Path $taskVs 'Common7/Tools/VsDevCmd.bat'
# Import only compiler search paths, leaving unrelated process settings alone.
$taskCmd = Join-Path $env:SystemRoot 'System32/cmd.exe'
$taskEnvironment = & $taskCmd /d /s /c "call `"$taskDev`" -arch=x64 >nul && set PATH && set INCLUDE && set LIB"
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize Visual Studio build paths.' }
foreach ($taskEntry in $taskEnvironment) {
    if ($taskEntry -match '^(PATH|INCLUDE|LIB|LIBPATH)=(.*)$') {
        Set-Item -LiteralPath "Env:$($matches[1])" -Value $matches[2]
    }
}

function Test-BuildPathFile([string]$SearchPath, [string]$File) {
    foreach ($taskDirectory in $SearchPath.Split(';')) {
        if ($taskDirectory -and (Test-Path -LiteralPath (Join-Path $taskDirectory.Trim('"') $File))) { return $true }
    }
    return $false
}

# Some Build Tools installations find MSVC but omit their installed SDK from
# VsDevCmd's paths. Complete only missing SDK paths; normal setups stay intact.
$taskNeedUm = -not (Test-BuildPathFile $env:LIB 'OleAut32.lib')
$taskNeedUcrt = -not (Test-BuildPathFile $env:LIB 'ucrt.lib')
$taskNeedInclude = -not ((Test-BuildPathFile $env:INCLUDE 'Windows.h') -and (Test-BuildPathFile $env:INCLUDE 'corecrt.h'))
$taskNeedRc = -not (Get-Command rc.exe -ErrorAction SilentlyContinue)
if ($taskNeedUm -or $taskNeedUcrt -or $taskNeedInclude -or $taskNeedRc) {
    $taskSdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
    $taskSdk = Get-ChildItem -LiteralPath (Join-Path $taskSdkRoot 'Lib') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName 'um/x64/OleAut32.lib')) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'ucrt/x64/ucrt.lib')) -and
            (Test-Path -LiteralPath (Join-Path $taskSdkRoot "Include/$($_.Name)/um/Windows.h")) -and
            (Test-Path -LiteralPath (Join-Path $taskSdkRoot "Include/$($_.Name)/ucrt/corecrt.h")) -and
            (Test-Path -LiteralPath (Join-Path $taskSdkRoot "bin/$($_.Name)/x64/rc.exe"))
        } | Select-Object -First 1
    if (-not $taskSdk) { throw 'Install a Windows 10/11 SDK with x64 libraries and tools before packaging.' }
    if ($taskNeedUm) { $env:LIB += ';' + (Join-Path $taskSdk.FullName 'um/x64') }
    if ($taskNeedUcrt) { $env:LIB += ';' + (Join-Path $taskSdk.FullName 'ucrt/x64') }
    if ($taskNeedInclude) {
        foreach ($taskPart in @('um', 'shared', 'ucrt', 'winrt')) {
            $env:INCLUDE += ';' + (Join-Path $taskSdkRoot "Include/$($taskSdk.Name)/$taskPart")
        }
    }
    if ($taskNeedRc) { $env:PATH = (Join-Path $taskSdkRoot "bin/$($taskSdk.Name)/x64") + ';' + $env:PATH }
    Write-Host "Completed build paths from installed Windows SDK $($taskSdk.Name)."
}
$taskNode = (Get-Command node.exe).Source
$taskCli = Join-Path $taskRoot 'node_modules/@tauri-apps/cli/tauri.js'
Push-Location $taskRoot
try {
    & $taskNode $taskCli build --config $Config
    if ($LASTEXITCODE -ne 0) { throw "Native packaging failed ($LASTEXITCODE)." }
} finally { Pop-Location }
