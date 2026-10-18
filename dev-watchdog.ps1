<#
  PRIMESTACK POS - dev supervisor (auto-restart)

  WHY THIS EXISTS
  ---------------
  This Windows host intermittently kills node.exe with STATUS_ACCESS_VIOLATION
  (exit code 3221225477). When that happens the API (port 7000) or the Vite dev
  server (port 7001) silently disappears, which shows up as a blank dashboard or
  an empty funding-method catalog - not as an obvious crash.

  ts-node-dev (the backend's `npm run dev`) is especially fragile here: it has
  been observed to hang without ever binding the port and to take the host down
  with it. The API is therefore run from its compiled output, which is stable.

  WHAT IT DOES
  ------------
  Starts both servers, then polls them. Whenever one exits it is restarted after
  a short delay. Ctrl+C stops the supervisor and both servers.

  USAGE
  -----
    powershell -NoProfile -ExecutionPolicy Bypass -File .\dev-watchdog.ps1

  NOTE
  ----
  The API runs from backend\dist, so after editing backend TypeScript run
  `npm run build` inside backend\ for the change to take effect.

  Keep this file pure ASCII: Windows PowerShell 5.1 decodes a .ps1 without a BOM
  as ANSI, so a non-ASCII character such as an em dash becomes a stray quote and
  breaks parsing.

  Do not use Start-Transcript here: it hangs indefinitely under this tool host,
  which silently stops the supervisor before it starts anything.
#>

[CmdletBinding()]
param(
  [int]$RestartDelaySeconds = 3,
  [int]$PollSeconds = 2,
  [string]$LogPath = (Join-Path $env:TEMP 'primestack-watchdog.log')
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

function Write-Log {
  param([string]$Message, [string]$Color = 'Gray')
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line -ForegroundColor $Color
  try { Add-Content -Path $LogPath -Value $line -ErrorAction Stop } catch { }
}

$services = @(
  [pscustomobject]@{
    Name = 'api'
    Dir  = Join-Path $root 'backend'
    Exe  = 'node'
    Args = @('dist/server.js')
    Port = 7000
  },
  [pscustomobject]@{
    Name = 'client'
    Dir  = Join-Path $root 'client'
    Exe  = 'node'
    # npm.cmd cannot be launched through Start-Process with redirected output
    # here (it exits instantly with no output), so Vite is invoked directly.
    Args = @('node_modules/vite/bin/vite.js')
    Port = 7001
  }
)

function Test-PortInUse {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Start-WatchedProcess {
  param($svc)
  $outLog = Join-Path $env:TEMP ('primestack-{0}.out.log' -f $svc.Name)
  $errLog = Join-Path $env:TEMP ('primestack-{0}.err.log' -f $svc.Name)
  Start-Process -FilePath $svc.Exe -ArgumentList $svc.Args -WorkingDirectory $svc.Dir `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

Write-Log '[watchdog] PRIMESTACK POS dev supervisor - Ctrl+C to stop' 'Cyan'
Write-Log ('[watchdog] event log: {0}' -f $LogPath) 'DarkGray'

$procs = @{}
foreach ($svc in $services) {
  if (Test-PortInUse $svc.Port) {
    Write-Log ('[watchdog] WARNING port {0} is already held by another process; {1} may crash-loop until it is freed' -f $svc.Port, $svc.Name) 'Magenta'
  }
  try {
    $procs[$svc.Name] = Start-WatchedProcess $svc
    Write-Log ('[watchdog] {0} started (pid {1}, port {2})' -f $svc.Name, $procs[$svc.Name].Id, $svc.Port) 'Green'
  } catch {
    Write-Log ('[watchdog] {0} failed to start: {1}' -f $svc.Name, $_.Exception.Message) 'Red'
    $procs[$svc.Name] = $null
  }
}

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  foreach ($svc in $services) {
    $p = $procs[$svc.Name]
    if ($p -and -not $p.HasExited) { continue }

    $code = 'unknown'
    if ($p) { try { $code = $p.ExitCode } catch { } }

    Write-Log ('[watchdog] {0} is down (exit {1}) - restarting in {2}s' -f $svc.Name, $code, $RestartDelaySeconds) 'Yellow'
    Start-Sleep -Seconds $RestartDelaySeconds

    try {
      $procs[$svc.Name] = Start-WatchedProcess $svc
      Write-Log ('[watchdog] {0} restarted (pid {1})' -f $svc.Name, $procs[$svc.Name].Id) 'Green'
    } catch {
      Write-Log ('[watchdog] {0} restart failed: {1}' -f $svc.Name, $_.Exception.Message) 'Red'
      $procs[$svc.Name] = $null
    }
  }
}
