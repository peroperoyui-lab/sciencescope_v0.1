param(
  [ValidateSet('find','move','resize','bounds')][string]$Action = 'find',
  [string]$WindowTitle,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 450,
  [int]$Height = 800
)
$ErrorActionPreference = 'Stop'
$env:TEMP = Join-Path (Get-Location) '.sciencescope-local/temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
if (-not ('NativeGeometry' -as [type])) {
  Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeGeometry {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  public static IntPtr Find(uint pid, string title) { IntPtr found=IntPtr.Zero; EnumWindows((h,p)=>{uint current; GetWindowThreadProcessId(h,out current); var text=new StringBuilder(256); GetWindowText(h,text,text.Capacity); if(current==pid && text.ToString()==title){found=h;return false;} return true;},IntPtr.Zero); return found; }
  public static string Rect(IntPtr h) { RECT r; GetWindowRect(h,out r); return String.Format("{0},{1},{2},{3}",r.Left,r.Top,r.Right,r.Bottom); }
}
'@
}
$targetProcessId = $env:SCIENCESCOPE_NATIVE_PID
if (-not $targetProcessId -or -not $WindowTitle) { throw 'SCIENCESCOPE_NATIVE_PID and WindowTitle are required' }
$handle = [NativeGeometry]::Find([uint32]$targetProcessId,$WindowTitle)
if ($handle -eq [IntPtr]::Zero) { throw 'assistant native window not found' }
if ($Action -eq 'move') { [NativeGeometry]::SetWindowPos($handle,[IntPtr]::Zero,$X,$Y,0,0,0x0001 -bor 0x0004) | Out-Null }
if ($Action -eq 'resize') { [NativeGeometry]::SetWindowPos($handle,[IntPtr]::Zero,0,0,$Width,$Height,0x0002 -bor 0x0004) | Out-Null }
if ($Action -eq 'bounds') {
  Add-Type -AssemblyName System.Windows.Forms
  $area = [System.Windows.Forms.Screen]::FromHandle($handle).WorkingArea
  Write-Output "$($area.Left),$($area.Top),$($area.Right),$($area.Bottom)"
} else { [NativeGeometry]::Rect($handle) }
