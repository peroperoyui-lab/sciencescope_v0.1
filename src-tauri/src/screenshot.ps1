# Windows' Snipping Tool owns region selection. We only receive the new clipboard
# image; existing clipboard content is neither cleared nor attached accidentally.
# Protocol: https://learn.microsoft.com/windows/apps/develop/launch/launch-snipping-tool
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SnipState {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
'@
$sequence = [SnipState]::GetClipboardSequenceNumber()
Start-Process 'ms-screenclip:'
$watch = [Diagnostics.Stopwatch]::StartNew()
$seenOverlay = $false
$leftOverlay = $null
while ($watch.Elapsed.TotalMinutes -lt 3) {
  if ([SnipState]::GetClipboardSequenceNumber() -ne $sequence -and [Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [Windows.Forms.Clipboard]::GetImage()
    $stream = New-Object IO.MemoryStream
    try {
      $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
      [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
    } finally { $image.Dispose(); $stream.Dispose() }
    exit 0
  }
  if (([SnipState]::GetAsyncKeyState(27) -band 0x8000) -ne 0) { exit 0 }
  $foregroundId = [uint32]0
  [void][SnipState]::GetWindowThreadProcessId([SnipState]::GetForegroundWindow(), [ref]$foregroundId)
  $foreground = Get-Process -Id $foregroundId -ErrorAction SilentlyContinue
  if ($foreground.ProcessName -in @('ScreenClippingHost', 'SnippingTool')) {
    $seenOverlay = $true
    $leftOverlay = $null
  } elseif ($seenOverlay) {
    if ($null -eq $leftOverlay) { $leftOverlay = $watch.Elapsed.TotalSeconds }
    if ($watch.Elapsed.TotalSeconds - $leftOverlay -gt 1) { exit 0 }
  }
  Start-Sleep -Milliseconds 30
}
throw 'Screenshot did not complete. Please try again.'
