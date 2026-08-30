import { afterEach, describe, expect, it } from 'vitest';
import { buildResetClientConfig, parseResetCliArgs } from '@/scripts/reset-production-data';

const ORIGINAL_CA = process.env.SUPABASE_CA_PEM;

afterEach(() => {
  if (ORIGINAL_CA === undefined) delete process.env.SUPABASE_CA_PEM;
  else process.env.SUPABASE_CA_PEM = ORIGINAL_CA;
});

describe('production reset CLI', () => {
  it('defaults to a non-mutating dry run', () => {
    expect(parseResetCliArgs(['--sqlite-path', '/app/data/founder-os.db'])).toEqual({
      sqlitePath: '/app/data/founder-os.db',
      execute: false,
    });
  });

  it('requires separate execute and confirmation arguments', () => {
    expect(parseResetCliArgs([
      '--sqlite-path',
      '/app/data/founder-os.db',
      '--execute',
      '--confirm',
      'state-token',
    ])).toEqual({
      sqlitePath: '/app/data/founder-os.db',
      execute: true,
      confirm: 'state-token',
    });
  });

  it('uses verified TLS when the Supabase CA is configured', () => {
    process.env.SUPABASE_CA_PEM = 'test-ca';
    expect(buildResetClientConfig('postgres://example')).toEqual({
      connectionString: 'postgres://example',
      ssl: { ca: 'test-ca', rejectUnauthorized: true },
    });
  });
});
