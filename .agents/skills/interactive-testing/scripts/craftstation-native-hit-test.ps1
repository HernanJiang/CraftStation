param(
  [Parameter(Mandatory = $true)][int]$CdpPort,
  [Parameter(Mandatory = $true)][double]$ViewportWidth,
  [Parameter(Mandatory = $true)][double]$ViewportHeight,
  [Parameter(Mandatory = $true)][string]$PointsJson
)

$ErrorActionPreference = 'Stop'

# Read-only native hit testing. CDP mouse dispatch bypasses WM_NCHITTEST and
# therefore cannot detect an Electron drag region swallowing a visible button.
# Resolve the window from this managed session's CDP listener, never its title.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CraftStationNativeHitTest {
  public delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

  public static IntPtr FindWindow(uint owner) {
    IntPtr found = IntPtr.Zero;
    long largest = 0;
    EnumWindows((window, parameter) => {
      uint process; GetWindowThreadProcessId(window, out process);
      Rect rect;
      if (process == owner && IsWindowVisible(window) && GetClientRect(window, out rect)) {
        long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
        if (area > largest) { found = window; largest = area; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$listener = @(Get-NetTCPConnection -LocalPort $CdpPort -State Listen)
$owners = @($listener.OwningProcess | Sort-Object -Unique)
if ($owners.Count -ne 1) { throw 'Expected one managed CDP listener owner.' }
if ($ViewportWidth -le 0 -or $ViewportHeight -le 0) { throw 'Invalid renderer viewport.' }

$previousDpi = [CraftStationNativeHitTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $window = [CraftStationNativeHitTest]::FindWindow($owners[0])
  if ($window -eq [IntPtr]::Zero) { throw 'Managed Electron window is not visible.' }
  $clientRect = New-Object CraftStationNativeHitTest+Rect
  $clientOrigin = New-Object CraftStationNativeHitTest+Point
  if (-not [CraftStationNativeHitTest]::GetClientRect($window, [ref]$clientRect) -or
      -not [CraftStationNativeHitTest]::ClientToScreen($window, [ref]$clientOrigin)) {
    throw 'Cannot read managed window client geometry.'
  }
  $clientWidth = $clientRect.Right - $clientRect.Left
  $clientHeight = $clientRect.Bottom - $clientRect.Top
  $samples = @(foreach ($point in ($PointsJson | ConvertFrom-Json)) {
    if ($point.x -lt 0 -or $point.x -ge $ViewportWidth -or
        $point.y -lt 0 -or $point.y -ge $ViewportHeight) { throw 'Sample is outside the viewport.' }
    $screenPointX = $clientOrigin.X + [int][Math]::Round($point.x * $clientWidth / $ViewportWidth)
    $screenPointY = $clientOrigin.Y + [int][Math]::Round($point.y * $clientHeight / $ViewportHeight)
    $packedPoint = (($screenPointY -band 65535) -shl 16) -bor ($screenPointX -band 65535)
    $hit = [IntPtr]::Zero
    if ([CraftStationNativeHitTest]::SendMessageTimeout($window, 0x84, [IntPtr]::Zero,
        [IntPtr]$packedPoint, 2, 2000, [ref]$hit) -eq [IntPtr]::Zero) {
      throw 'Native hit test timed out.'
    }
    [pscustomobject]@{ x = $point.x; y = $point.y; hit = $hit.ToInt32() }
  })
  [pscustomobject]@{ processId = $owners[0]; samples = $samples } | ConvertTo-Json -Compress
} finally {
  [void][CraftStationNativeHitTest]::SetThreadDpiAwarenessContext($previousDpi)
}
