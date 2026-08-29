import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'archive-production-backup.ps1'), 'utf8');

describe('archive-production-backup PowerShell safety contract', () => {
  it('routes every native Railway invocation through the exit-code wrapper', () => {
    expect(script).toContain('function Invoke-NativeCommand');
    expect(script.match(/& railway\.cmd/g)).toHaveLength(1);
    expect(script.match(/Invoke-NativeCommand -Executable 'railway\.cmd'/g)).toHaveLength(1);
  });

  it('does not let native stderr warnings inherit Stop semantics', () => {
    expect(script).toContain("$ErrorActionPreference = 'Continue'");
    expect(script).toContain('2>$null');
    expect(script).toContain('$nativeExitCode = $LASTEXITCODE');
    expect(script).toContain('$ErrorActionPreference = $previousPreference');
  });

  it('reports a fixed step category instead of a raw unexpected exception', () => {
    expect(script).toContain("$currentStep = 'remote_backup'");
    expect(script).toContain("$category = $currentStep + '_failed'");
  });

  it('retries downloads only, never the remote backup command', () => {
    expect(script).toContain('function Invoke-RailwayDownload');
    expect(script.match(/Invoke-RailwayDownload -CommandArguments/g)).toHaveLength(2);
    expect(script.match(/Start-Sleep -Seconds 2/g)).toHaveLength(1);
    expect(script.match(/'ssh', '--', 'npm', 'run', 'backup:sqlite'/g)).toHaveLength(1);
  });
});
