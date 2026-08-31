import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('REKREOS typography system', () => {
  test('uses SF Pro for interface typography with safe production fallbacks', () => {
    const tailwind = read('tailwind.config.ts');
    expect(tailwind).toContain('"SF Pro Display"');
    expect(tailwind).toContain('"SF Pro Text"');
    expect(tailwind).toContain('BlinkMacSystemFont');
    expect(tailwind).toContain('"Segoe UI"');
    expect(tailwind).toContain("display:");
  });

  test('uses SF Pro Text with tabular numerals for data and technical labels', () => {
    const tailwind = read('tailwind.config.ts');
    const layout = read('app/layout.tsx');
    const globals = read('app/globals.css');
    expect(tailwind).toContain('mono: appleText');
    expect(tailwind).not.toContain('JetBrains Mono');
    expect(layout).not.toContain('JetBrains_Mono');
    expect(layout).not.toContain('--font-mono');
    expect(globals).toContain('font-variant-numeric: tabular-nums');
  });

  test('applies the display face to the main title and wordmark', () => {
    expect(read('components/PageHeader.tsx')).toContain('font-display');
    expect(read('components/Sidebar.tsx')).toContain('font-display');
    expect(read('app/globals.css')).toContain('font-sans');
  });
});
