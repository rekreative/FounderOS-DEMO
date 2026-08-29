param(
  [Parameter(Mandatory = $true)]
  [string]$DestinationRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$statusPath = Join-Path $DestinationRoot 'latest-status.json'
$tsxBin = Join-Path $repoRoot 'node_modules\.bin\tsx.cmd'
$partialDir = $null
$runId = $null
$currentStep = 'initialization'

function Write-BackupStatus {
  param([bool]$Ok, [string]$Category, [string]$CompletedRunId, [string]$ArchivePath)

  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  [ordered]@{
    ok = $Ok
    category = $Category
    runId = $CompletedRunId
    archivePath = $ArchivePath
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

function Invoke-NativeCommand {
  param([string]$Executable, [string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell represents a native program's stderr as error
    # records. Railway writes harmless update notices there, so rely on the
    # native exit code and keep Stop semantics for every PowerShell cmdlet.
    $ErrorActionPreference = 'Continue'
    $nativeOutput = @(& $Executable @Arguments 2>$null)
    $nativeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  [pscustomobject]@{ Output = $nativeOutput; ExitCode = $nativeExitCode }
}

function Invoke-RailwayDownload {
  param([string[]]$CommandArguments)

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $downloadExitCode = 1
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      & railway.cmd @CommandArguments 2>$null | Out-Null
      $downloadExitCode = $LASTEXITCODE
      if ($downloadExitCode -eq 0) { break }
      if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
    }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return $downloadExitCode
}

try {
  $currentStep = 'local_preflight'
  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  if (-not (Test-Path -LiteralPath $tsxBin)) { throw 'local_dependencies_missing' }
  Push-Location $repoRoot
  try {
    $currentStep = 'remote_backup'
    $backupCommand = Invoke-NativeCommand -Executable 'railway.cmd' -Arguments @('ssh', '--', 'npm', 'run', 'backup:sqlite')
    if ($backupCommand.ExitCode -ne 0) { throw 'remote_backup_failed' }
    $backupOutput = $backupCommand.Output

    $currentStep = 'remote_result_parse'
    $matches = @($backupOutput | Select-String -Pattern '^SQLite backup run (\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)$')
    if ($matches.Count -ne 1) { throw 'remote_backup_result_invalid' }
    $runId = $matches[0].Matches[0].Groups[1].Value

    $currentStep = 'local_staging'
    $finalDir = Join-Path $DestinationRoot $runId
    if (Test-Path -LiteralPath $finalDir) { throw 'local_archive_collision' }
    $partialDir = Join-Path $DestinationRoot ('.partial-' + $runId)
    if (Test-Path -LiteralPath $partialDir) { throw 'partial_archive_collision' }
    New-Item -ItemType Directory -Path $partialDir | Out-Null

    $currentStep = 'manifest_download'
    $manifestName = 'manifest-' + $runId + '.json'
    $manifestDownloadArguments = [string[]]@('service', 'files', 'download', ('/app/data/backups/' + $manifestName), (Join-Path $partialDir $manifestName))
    $manifestDownloadExit = Invoke-RailwayDownload -CommandArguments $manifestDownloadArguments
    if ($manifestDownloadExit -ne 0) { throw 'manifest_download_failed' }

    $currentStep = 'manifest_validation'
    $manifestValidation = Invoke-NativeCommand -Executable $tsxBin -Arguments @('scripts/verify-downloaded-backup.ts', '--manifest-only', $partialDir, $runId)
    if ($manifestValidation.ExitCode -ne 0) { throw 'manifest_validation_failed' }
    $filenames = @($manifestValidation.Output)
    if ($filenames.Count -lt 1) { throw 'manifest_snapshot_set_empty' }

    $snapshotIndex = 0
    foreach ($rawFilename in $filenames) {
      $snapshotIndex++
      $currentStep = 'snapshot_download_' + $snapshotIndex
      if ($rawFilename -isnot [string]) { throw 'manifest_snapshot_filename_invalid' }
      $filename = [string]$rawFilename
      $snapshotDownloadArguments = [string[]]@('service', 'files', 'download', ('/app/data/backups/' + $filename), (Join-Path $partialDir $filename))
      $snapshotDownloadExit = Invoke-RailwayDownload -CommandArguments $snapshotDownloadArguments
      if ($snapshotDownloadExit -ne 0) { throw 'snapshot_download_failed' }
    }

    $currentStep = 'archive_verification'
    $archiveVerification = Invoke-NativeCommand -Executable $tsxBin -Arguments @('scripts/verify-downloaded-backup.ts', $partialDir, $runId)
    if ($archiveVerification.ExitCode -ne 0) { throw 'archive_verification_failed' }

    $currentStep = 'archive_finalize'
    Move-Item -LiteralPath $partialDir -Destination $finalDir
    $partialDir = $null
    Write-BackupStatus -Ok $true -Category 'ok' -CompletedRunId $runId -ArchivePath $finalDir
    Write-Host "Production SQLite backup archived and verified: $runId"
  } finally {
    Pop-Location
  }
} catch {
  if ($partialDir -and (Test-Path -LiteralPath $partialDir)) {
    $failedDir = Join-Path $DestinationRoot ('.failed-' + $runId)
    if ($runId -and -not (Test-Path -LiteralPath $failedDir)) {
      Move-Item -LiteralPath $partialDir -Destination $failedDir
    }
  }
  if ($_.Exception.Message -match '^[a-z_]+$') {
    $category = $_.Exception.Message
  } else {
    $category = $currentStep + '_failed'
  }
  Write-BackupStatus -Ok $false -Category $category -CompletedRunId $runId -ArchivePath $null
  Write-Error "Production SQLite backup automation failed: $category"
  exit 1
}
