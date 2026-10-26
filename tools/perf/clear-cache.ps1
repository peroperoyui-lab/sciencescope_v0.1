param(
    [Parameter(Mandatory=$true)][string]$RamMap,
    [Parameter(Mandatory=$true)][string]$Receipt,
    [int]$Run = 1,
    [switch]$Elevate
)
$ErrorActionPreference = 'Stop'
$taskExecutable = (Resolve-Path -LiteralPath $RamMap).Path
$taskReceipt = [IO.Path]::GetFullPath($Receipt)
$taskAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $taskAdministrator) {
    if (-not $Elevate) { throw 'System file-cache clearing requires administrator confirmation.' }
    $taskArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RamMap "{1}" -Receipt "{2}" -Run {3}' -f $PSCommandPath, $taskExecutable, $taskReceipt, $Run
    $taskChild = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -ArgumentList $taskArguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($taskChild.ExitCode -ne 0) { throw "Cache clearing exited $($taskChild.ExitCode)." }
    Get-Content -LiteralPath $taskReceipt -Raw
    exit 0
}
$taskSignature = Get-AuthenticodeSignature -LiteralPath $taskExecutable
if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation,') {
    throw 'Use the Microsoft-signed RAMMap executable from Sysinternals.'
}
function Read-CacheCounters {
    $taskMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    [ordered]@{
        systemCacheBytes = [long]$taskMemory.SystemCacheResidentBytes
        standbyBytes = [long]$taskMemory.StandbyCacheCoreBytes + [long]$taskMemory.StandbyCacheNormalPriorityBytes + [long]$taskMemory.StandbyCacheReserveBytes
    }
}
$taskBefore = Read-CacheCounters
# Empty file-cache working pages and the standby list, not live application
# working sets or the modified-page list. RAMMap is a local test tool only.
foreach ($taskAction in @('-Es', '-Et')) {
    $taskChild = Start-Process -FilePath $taskExecutable -ArgumentList '-accepteula', $taskAction -WindowStyle Hidden -Wait -PassThru
    if ($taskChild.ExitCode -ne 0) { throw "RAMMap $taskAction exited $($taskChild.ExitCode)." }
}
$taskResult = [ordered]@{
    success = $true
    method = 'Microsoft RAMMap: Empty System Working Sets, Empty Standby List'
    run = $Run
    clearedAt = [DateTimeOffset]::UtcNow.ToString('o')
    before = $taskBefore
    after = Read-CacheCounters
}
New-Item -ItemType Directory -Path (Split-Path $taskReceipt) -Force | Out-Null
$taskResult | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $taskReceipt -Encoding UTF8
$taskResult | ConvertTo-Json -Depth 4
