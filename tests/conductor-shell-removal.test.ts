import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Conductor shell removal', () => {
  const layout = read('app/(internal)/layout.tsx');
  const topbar = read('components/Topbar.tsx');
  const styles = read('app/globals.css');

  test('does not mount the floating Conductor panel', () => {
    expect(layout).not.toContain('ConductorPanel');
    expect(layout).not.toContain('--conductor-w');
  });

  test('does not expose a Conductor button in the top bar', () => {
    expect(topbar).not.toContain('CONDUCTOR_OPEN_EVENT');
    expect(topbar).not.toContain('Open the Conductor agent panel');
  });

  test('does not reserve or animate shell space for the removed panel', () => {
    expect(styles).not.toContain('conductor-dragging');
    expect(styles).not.toContain('transition: margin-right');
  });
});
