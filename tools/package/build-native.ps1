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
$taskNode = (Get-Command node.exe).Source
$taskCli = Join-Path $taskRoot 'node_modules/@tauri-apps/cli/tauri.js'
Push-Location $taskRoot
try {
    cmd.exe /d /s /c "call `"$taskDev`" -arch=x64 && `"$taskNode`" `"$taskCli`" build --config `"$Config`""
    if ($LASTEXITCODE -ne 0) { throw "Native packaging failed ($LASTEXITCODE)." }
} finally { Pop-Location }
