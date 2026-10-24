param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$Manifest,
    [Parameter(Mandatory=$true)][string]$MainBinary,
    [Parameter(Mandatory=$true)][string]$TimingLog
)
$ErrorActionPreference = 'Stop'
$taskTimer = [Diagnostics.Stopwatch]::StartNew()
$taskBase = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
# Windows PowerShell's .NET Framework still enforces MAX_PATH without the
# extended prefix. Keep it for every filesystem operation, including enumeration.
$taskRoot = if ($taskBase.StartsWith('\\')) { '\\?\UNC\' + $taskBase.Substring(2) } else { '\\?\' + $taskBase }
$taskFolders = @('app', 'node_modules', 'runtime', 'python', 'models', 'reference')
$taskRootFiles = @('package.json', 'LICENSE', 'THIRD_PARTY_NOTICES', 'program-files.txt', $MainBinary)
$taskNewFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$taskDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$taskRemoved = 0
$taskParentLinks = [Collections.Generic.Dictionary[string,bool]]::new([StringComparer]::OrdinalIgnoreCase)

function Get-ProgramPath([string]$Relative) {
    $taskRelative = $Relative.Replace('/', '\').Trim()
    $taskParts = $taskRelative.Split('\')
    if ([IO.Path]::IsPathRooted($taskRelative) -or $taskParts -contains '..' -or $taskParts -contains '.') {
        throw 'The program manifest must contain canonical relative paths.'
    }
    $taskAbsolute = [IO.Path]::Combine($taskRoot, $taskRelative)
    if (-not $taskAbsolute.StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The program manifest contains a path outside the installation.'
    }
    $taskRelative = $taskAbsolute.Substring($taskRoot.Length + 1)
    $taskParts = $taskRelative.Split('\')
    if (($taskParts.Length -gt 1 -and $taskFolders -contains $taskParts[0]) -or
        ($taskParts.Length -eq 1 -and $taskRootFiles -contains $taskRelative)) {
        return $taskAbsolute
    }
    throw 'The program manifest contains a path not owned by the installer.'
}

function Test-LinkedParent([string]$Directory) {
    if ($Directory -eq $taskRoot) { return $false }
    if ($taskParentLinks.ContainsKey($Directory)) { return $taskParentLinks[$Directory] }
    $taskLinked = Test-LinkedParent ([IO.Path]::GetDirectoryName($Directory))
    if (-not $taskLinked -and [IO.Directory]::Exists($Directory)) {
        $taskLinked = ([IO.File]::GetAttributes($Directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0
    }
    $taskParentLinks[$Directory] = $taskLinked
    return $taskLinked
}

try {
    foreach ($taskLine in [IO.File]::ReadAllLines($Manifest)) {
        if ($taskLine.Trim()) { [void]$taskNewFiles.Add((Get-ProgramPath $taskLine)) }
    }
    $taskOldManifest = [IO.Path]::Combine($taskRoot, 'program-files.txt')
    $taskOldFiles = [Collections.Generic.List[string]]::new()
    if ([IO.File]::Exists($taskOldManifest)) {
        foreach ($taskLine in [IO.File]::ReadAllLines($taskOldManifest)) {
            if ($taskLine.Trim()) { $taskOldFiles.Add((Get-ProgramPath $taskLine)) }
        }
    } else {
        # Earlier installers had no manifest. Enumerate only their known program
        # directories; user files beside them and the entire data directory stay.
        foreach ($taskFolder in $taskFolders) {
            $taskDirectory = [IO.Path]::Combine($taskRoot, $taskFolder)
            if ([IO.Directory]::Exists($taskDirectory) -and -not (Test-LinkedParent $taskDirectory)) {
                $taskPending = [Collections.Generic.Stack[string]]::new()
                $taskPending.Push($taskDirectory)
                while ($taskPending.Count) {
                    foreach ($taskEntry in [IO.Directory]::GetFileSystemEntries($taskPending.Pop())) {
                        $taskAttributes = [IO.File]::GetAttributes($taskEntry)
                        if (($taskAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                        if (($taskAttributes -band [IO.FileAttributes]::Directory) -ne 0) { $taskPending.Push($taskEntry) }
                        else { $taskOldFiles.Add($taskEntry) }
                    }
                }
            }
        }
        foreach ($taskFile in $taskRootFiles) {
            $taskOldFiles.Add([IO.Path]::Combine($taskRoot, $taskFile))
        }
    }
    foreach ($taskFile in $taskOldFiles) {
        if ($taskNewFiles.Contains($taskFile) -or -not [IO.File]::Exists($taskFile)) { continue }
        if (Test-LinkedParent ([IO.Path]::GetDirectoryName($taskFile))) { continue }
        # No recursive removal: keep shared files in place, delete obsolete
        # files individually, and only remove their parents once they are empty.
        $taskRelative = $taskFile.Substring($taskRoot.Length + 1)
        $taskChecked = Get-ProgramPath $taskRelative
        [IO.File]::Delete($taskChecked)
        $taskRemoved++
        $taskParent = [IO.Path]::GetDirectoryName($taskChecked)
        while ($taskParent -ne $taskRoot) {
            [void]$taskDirectories.Add($taskParent)
            $taskParent = [IO.Path]::GetDirectoryName($taskParent)
        }
    }
    foreach ($taskDirectory in ($taskDirectories | Sort-Object Length -Descending)) {
        if ([IO.Directory]::Exists($taskDirectory) -and
            [IO.Directory]::GetFileSystemEntries($taskDirectory).Length -eq 0) {
            [IO.Directory]::Delete($taskDirectory, $false)
        }
    }
    $taskTimer.Stop()
    [ordered]@{milliseconds=$taskTimer.ElapsedMilliseconds;removedFiles=$taskRemoved;retainedManifestFiles=$taskNewFiles.Count} |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $TimingLog -Encoding UTF8
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
