param([switch]$Install, [string]$Proxy)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Local = Join-Path $ProjectRoot '.sciencescope-local'
$env:RUSTUP_HOME = Join-Path $Local 'runtimes\rustup'
$env:CARGO_HOME = Join-Path $Local 'cache\cargo'
$env:CARGO_TARGET_DIR = Join-Path $Local 'build\tauri'
if ($Proxy) { $env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy }
$env:TEMP = Join-Path $Local 'temp'; $env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:RUSTUP_HOME,$env:CARGO_HOME,$env:TEMP,(Join-Path $Local 'downloads') | Out-Null
$env:Path = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:Path
$installer = Join-Path $Local 'downloads\rustup-init.exe'
if ($Install -and -not (Test-Path $installer)) { Invoke-WebRequest 'https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $installer }
if ($Install) {
    $rustup = Join-Path $env:CARGO_HOME 'bin\rustup.exe'
    if (Test-Path -LiteralPath $rustup) { & $rustup toolchain install stable --profile minimal }
    else { & $installer -y --no-modify-path --profile minimal --default-toolchain stable }
    if ($LASTEXITCODE -ne 0) { throw 'Project-local Rust installation failed.' }
}
Write-Output "RUSTUP_HOME=$env:RUSTUP_HOME"; Write-Output "CARGO_HOME=$env:CARGO_HOME"
Write-Output 'Run cargo with this same process environment; no user/global PATH changes are made.'
