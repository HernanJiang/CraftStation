param(
  [Parameter(Mandatory = $true)][string]$SessionFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [ValidateRange(5, 60)][int]$Seconds = 30
)

$ErrorActionPreference = 'Stop'
$session = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
if ($session.state -ne 'ready' -or !$session.appPid) { throw '需要 READY 状态的 owned smoke session。' }
$processes = @(Get-CimInstance Win32_Process)
$owned = [System.Collections.Generic.HashSet[int]]::new()
[void]$owned.Add([int]$session.appPid)
do {
  $added = $false
  foreach ($item in $processes) {
    if ($owned.Contains([int]$item.ParentProcessId) -and $owned.Add([int]$item.ProcessId)) { $added = $true }
  }
} while ($added)
$electron = @($processes | Where-Object {
  $owned.Contains([int]$_.ProcessId) -and $_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=|supervisor\.cjs|Worker\.(cjs|mjs)'
})
if ($electron.Count -ne 1) { throw "需要唯一 owned Electron 主进程，实际 $($electron.Count)。" }
$appProcessId = [int]$electron[0].ProcessId
$cpuCount = [Environment]::ProcessorCount
$startedUtc = [DateTime]::UtcNow
$samples = @()
$clock = [Diagnostics.Stopwatch]::StartNew()
for ($index = 0; $index -le $Seconds; $index++) {
  $processes = @(Get-CimInstance Win32_Process)
  $appTree = [System.Collections.Generic.HashSet[int]]::new()
  [void]$appTree.Add($appProcessId)
  do {
    $added = $false
    foreach ($item in $processes) {
      if ($appTree.Contains([int]$item.ParentProcessId) -and $appTree.Add([int]$item.ProcessId)) { $added = $true }
    }
  } while ($added)
  $rows = @($processes | Where-Object { $appTree.Contains([int]$_.ProcessId) } | ForEach-Object {
    # 只记录角色和资源计数，不保存可能含凭据的命令行。
    $role = if ($_.ProcessId -eq $appProcessId) { 'main' }
      elseif ($_.CommandLine -match '--type=renderer') { 'renderer' }
      elseif ($_.CommandLine -match '--type=gpu-process') { 'gpu' }
      elseif ($_.CommandLine -match 'supervisor\.cjs') { 'supervisor' }
      else { 'child' }
    [pscustomobject]@{
      processId = [int]$_.ProcessId; role = $role; name = $_.Name
      instance = "$($_.ProcessId)@$($_.CreationDate.ToUniversalTime().ToString('o'))"
      createdDuringMeasurement = $_.CreationDate.ToUniversalTime() -ge $startedUtc
      cpuMs = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000
      workingSetBytes = [double]$_.WorkingSetSize; privateBytes = [double]$_.PrivatePageCount
      readBytes = [double]$_.ReadTransferCount; writtenBytes = [double]$_.WriteTransferCount
    }
  })
  $samples += [pscustomobject]@{ elapsedMs = $clock.Elapsed.TotalMilliseconds; processes = $rows }
  if ($index -lt $Seconds) { Start-Sleep -Milliseconds 1000 }
}
$first = $samples[0]; $last = $samples[-1]
$cpuMs = 0.0; $readBytes = 0.0; $writtenBytes = 0.0
$processSetChanged = $false
for ($index = 1; $index -lt $samples.Count; $index++) {
  $previousInstances = @($samples[$index - 1].processes.instance)
  $currentInstances = @($samples[$index].processes.instance)
  if (@(Compare-Object $previousInstances $currentInstances).Count -gt 0) { $processSetChanged = $true }
  foreach ($current in $samples[$index].processes) {
    $previous = @($samples[$index - 1].processes | Where-Object instance -eq $current.instance)
    if ($previous.Count -eq 1) {
      $cpuMs += [Math]::Max(0, $current.cpuMs - $previous[0].cpuMs)
      $readBytes += [Math]::Max(0, $current.readBytes - $previous[0].readBytes)
      $writtenBytes += [Math]::Max(0, $current.writtenBytes - $previous[0].writtenBytes)
    } elseif ($current.createdDuringMeasurement) {
      $cpuMs += $current.cpuMs
      $readBytes += $current.readBytes
      $writtenBytes += $current.writtenBytes
    }
  }
}
$workingSets = @($samples | ForEach-Object { ($_.processes | Measure-Object workingSetBytes -Sum).Sum } | Sort-Object)
$privateSets = @($samples | ForEach-Object { ($_.processes | Measure-Object privateBytes -Sum).Sum } | Sort-Object)
$summary = [pscustomobject]@{
  elapsedMs = $last.elapsedMs - $first.elapsedMs; logicalProcessors = $cpuCount
  cpuMs = $cpuMs; cpuPercentMachine = 100 * $cpuMs / ($last.elapsedMs - $first.elapsedMs) / $cpuCount
  medianWorkingSetMiB = $workingSets[[int][Math]::Floor($workingSets.Count / 2)] / 1MB
  medianPrivateMiB = $privateSets[[int][Math]::Floor($privateSets.Count / 2)] / 1MB
  peakWorkingSetMiB = $workingSets[-1] / 1MB; readBytes = $readBytes; writtenBytes = $writtenBytes
  processSetChanged = $processSetChanged
  cpuAndIoAreObservedLowerBounds = $true
}
$result = @{ session = $session.id; scope = 'Electron main and descendants; excludes Vite/compiler; I/O includes pipes. CPU/I/O are observed lower bounds: exited processes can lose their last interval and unseen short-lived children are missed. Changed process sets must not be compared as exact totals.'; summary = $summary; samples = $samples }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputFile -Encoding utf8
$summary | ConvertTo-Json
