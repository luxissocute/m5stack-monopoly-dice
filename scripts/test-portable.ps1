param([string]$Exe = 'release/Labu-Toy-City-1.0.1-Windows.exe')
$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path -LiteralPath $Exe).Path
$launcher = Start-Process -FilePath $exePath -WindowStyle Hidden -PassThru
$ownedIds = @($launcher.Id)
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest 'http://127.0.0.1:49180/game' -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match 'Labu') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Portable executable did not start its game service.' }
  $config = Invoke-RestMethod 'http://127.0.0.1:49180/desktop-config.json' -TimeoutSec 2
  if ($config.roomUrl -notmatch '^ws://127\.0\.0\.1:') { throw 'Room service was not started.' }
  $processes = @(Get-CimInstance Win32_Process)
  do {
    $previousCount = $ownedIds.Count
    $ownedIds = @($ownedIds + @($processes | Where-Object { $_.ParentProcessId -in $ownedIds } | Select-Object -ExpandProperty ProcessId) | Select-Object -Unique)
  } while ($ownedIds.Count -gt $previousCount)
  $game = @(Get-Process -Id $ownedIds -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Labu Toy City' -and $_.MainWindowTitle })
  if (-not $game.Count) { throw 'Portable executable did not create a game window.' }
  Write-Output 'PASS: single EXE extracts, opens the game window, serves bundled assets and starts the room service.'
} finally {
  foreach ($taskProcess in @(Get-Process -Id $ownedIds -ErrorAction SilentlyContinue)) {
    if ($taskProcess.MainWindowHandle) { $null = $taskProcess.CloseMainWindow() }
  }
  $null = $launcher.WaitForExit(2000)
  # Only stop processes started by this smoke test; X now opens a choice dialog.
  Get-Process -Id $ownedIds -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
