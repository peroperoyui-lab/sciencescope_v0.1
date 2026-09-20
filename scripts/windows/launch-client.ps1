# Launch the existing development client; no compile, downloads or global settings.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
try {
    $clientPath = Join-Path $projectRoot '.sciencescope-local\build\tauri\debug\sciencescope-desktop.exe'
    if (-not (Test-Path -LiteralPath $clientPath)) {
        throw 'The desktop executable has not been built. Run scripts/windows/run-desktop.ps1 once.'
    }
    $existing = Get-Process -Name 'sciencescope-desktop' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $clientPath } | Select-Object -First 1
    if ($existing) {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.AppActivate($existing.Id)
        exit 0
    }
    $nodeCandidates = @(
        (Join-Path $projectRoot '.sciencescope-local\runtimes\node\node.exe'),
        (Join-Path $projectRoot '.sciencescope-local\runtimes\node.exe')
    )
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    # Development-machine fallback only; release packaging must ship its own Node.
    $nodeCandidates += 'D:\nodejs\node.exe'
    $nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $nodePath) { throw 'Node.js was not found. This development client needs the configured local Node runtime.' }
    $env:SCIENCESCOPE_NODE = $nodePath
    $env:SCIENCESCOPE_HOST_SCRIPT = Join-Path $projectRoot 'scripts\preview-desktop.mjs'
    # This is the interactive window explicitly requested by the user.
    Start-Process -FilePath $clientPath -WorkingDirectory $projectRoot
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'ScienceScope startup') | Out-Null
    exit 1
}
