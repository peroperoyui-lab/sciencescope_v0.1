param([switch]$InstallRust, [string]$Proxy, [switch]$Check)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $root 'scripts\windows\setup-rust.ps1') -Install:$InstallRust -Proxy $Proxy
Push-Location $root
try {
    & node 'scripts\build-desktop.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Desktop resource preparation failed.' }
    & (Join-Path $PSScriptRoot 'prepare-icon.ps1')
    $vsdev = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat'
    if (-not (Test-Path -LiteralPath $vsdev)) { throw "MSVC developer command file not found: $vsdev" }
    $cargo = Join-Path $env:CARGO_HOME 'bin\cargo.exe'
    if (-not (Test-Path -LiteralPath $cargo)) { throw "Project-local cargo not found: $cargo" }
    $env:SCIENCESCOPE_NODE = (Resolve-Path -LiteralPath (Get-Command node -ErrorAction Stop).Source).Path
    $env:SCIENCESCOPE_HOST_SCRIPT = (Join-Path $root 'scripts\preview-desktop.mjs')
    $cargoAction = if ($Check) { 'check' } else { 'run' }
    cmd.exe /d /s /c "call `"$vsdev`" -arch=x64 && `"$cargo`" $cargoAction --manifest-path `"$root\src-tauri\Cargo.toml`""
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally { Pop-Location }
