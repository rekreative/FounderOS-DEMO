import { describe, expect, it } from 'vitest';
import { assessPhoneQuality } from '@/lib/phone';

describe('assessPhoneQuality', () => {
  it('accepts a plausible international phone', () => {
    expect(assessPhoneQuality('+34 645 591 251')).toEqual({ status: 'valid', reason: null });
  });

  it('flags letters or unsupported characters for manual validation', () => {
    expect(assessPhoneQuality('+34 645X91251')).toEqual({ status: 'invalid', reason: 'invalid_characters' });
  });

  it('flags implausible lengths and keeps missing values neutral', () => {
    expect(assessPhoneQuality('1234')).toEqual({ status: 'invalid', reason: 'invalid_length' });
    expect(assessPhoneQuality(null)).toEqual({ status: 'unknown', reason: 'missing' });
  });
});
