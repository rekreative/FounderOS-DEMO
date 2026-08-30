import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('OS mark branding', () => {
  test('uses the REKREOS rocket mark with the approved gradient and transparent app chrome', () => {
    const mark = read('components/OsMark.tsx');
    expect(mark).toContain('#ec008c');
    expect(mark).toContain('#ff7a45');
    expect(mark).not.toContain('fill="#050505"');
    expect(mark).toContain('rekreos-mark-gradient');
  });

  test('the sidebar and browser icon share the same mark', () => {
    const sidebar = read('components/Sidebar.tsx');
    const icon = read('app/icon.svg');
    expect(sidebar).toContain('OsMark');
    expect(sidebar).toContain('>REKREOS<');
    expect(sidebar).toContain('whitespace-nowrap');
    expect(icon).toContain('#ec008c');
    expect(icon).toContain('#ff7a45');
    expect(icon).toContain('#050505');
    expect(icon).toContain('rx="18"');
    expect(icon).toContain('transform="translate(14 14) scale(.72)"');
  });
});
