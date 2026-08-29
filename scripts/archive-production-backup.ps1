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

try {
  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  if (-not (Test-Path -LiteralPath $tsxBin)) { throw 'local_dependencies_missing' }
  Push-Location $repoRoot
  try {
    $backupOutput = @(& railway.cmd ssh -- npm run backup:sqlite 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'remote_backup_failed' }

    $matches = @($backupOutput | Select-String -Pattern '^SQLite backup run (\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)$')
    if ($matches.Count -ne 1) { throw 'remote_backup_result_invalid' }
    $runId = $matches[0].Matches[0].Groups[1].Value

    $finalDir = Join-Path $DestinationRoot $runId
    if (Test-Path -LiteralPath $finalDir) { throw 'local_archive_collision' }
    $partialDir = Join-Path $DestinationRoot ('.partial-' + $runId)
    if (Test-Path -LiteralPath $partialDir) { throw 'partial_archive_collision' }
    New-Item -ItemType Directory -Path $partialDir | Out-Null

    $manifestName = 'manifest-' + $runId + '.json'
    & railway.cmd service files download ('/app/data/backups/' + $manifestName) (Join-Path $partialDir $manifestName)
    if ($LASTEXITCODE -ne 0) { throw 'manifest_download_failed' }

    $fileJson = & $tsxBin scripts/verify-downloaded-backup.ts --manifest-only $partialDir $runId
    if ($LASTEXITCODE -ne 0) { throw 'manifest_validation_failed' }
    $filenames = @($fileJson | ConvertFrom-Json)
    if ($filenames.Count -lt 1) { throw 'manifest_snapshot_set_empty' }

    foreach ($filename in $filenames) {
      & railway.cmd service files download ('/app/data/backups/' + $filename) (Join-Path $partialDir $filename)
      if ($LASTEXITCODE -ne 0) { throw 'snapshot_download_failed' }
    }

    & $tsxBin scripts/verify-downloaded-backup.ts $partialDir $runId
    if ($LASTEXITCODE -ne 0) { throw 'archive_verification_failed' }

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
  $category = if ($_.Exception.Message -match '^[a-z_]+$') { $_.Exception.Message } else { 'unexpected_failure' }
  Write-BackupStatus -Ok $false -Category $category -CompletedRunId $runId -ArchivePath $null
  Write-Error "Production SQLite backup automation failed: $category"
  exit 1
}
