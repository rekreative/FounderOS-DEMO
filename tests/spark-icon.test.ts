import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SparkIcon } from '@/components/SparkIcon';

describe('SparkIcon', () => {
  it('renders the emblem inline without requesting the missing PNG', () => {
    const markup = renderToStaticMarkup(createElement(SparkIcon, { size: 18, shade: '#123456' }));
    expect(markup).toContain('<svg');
    expect(markup).toContain('aria-label="Vantage"');
    expect(markup).toContain('width="18"');
    expect(markup).toContain('height="18"');
    expect(markup).toContain('fill="#123456"');
    expect(markup).toContain('emblem');
    expect(markup).not.toMatch(/vantage-emblem\.png|mask-image|url\(/i);
  });

  it('keeps the caller class and default accent color', () => {
    const markup = renderToStaticMarkup(createElement(SparkIcon, { className: 'custom-mark' }));
    expect(markup).toContain('custom-mark');
    expect(markup).toContain('fill="var(--accent)"');
  });
});
