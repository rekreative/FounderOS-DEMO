import { describe, expect, it } from 'vitest';
import { LEAD_STAGE_OPTIONS, getClientNameForLead, getStageLabel } from '@/lib/leads';

// Backend V1 UI cutover (2026-08-21): lib/leads.ts's localStorage
// persistence functions (getLeads/createLead/updateLead/setLeadStage/
// appendLeadEvent/getLeadEvents/initializeLeadsStoreIfNeeded) were removed —
// every runtime consumer moved to lib/api/leads.ts (PostgreSQL-backed, see
// tests/leads-repo.test.ts and tests/api-leads.test.ts for the real
// persistence + scope-invariant coverage). This file now covers only what
// lib/leads.ts still owns: types/constants and the two pure display helpers.

describe('getStageLabel', () => {
  it('returns the Spanish label for every known stage', () => {
    for (const option of LEAD_STAGE_OPTIONS) {
      expect(getStageLabel(option.id)).toBe(option.label);
    }
  });
});

describe('getClientNameForLead', () => {
  it('returns Interno for a null clientId, never a fabricated client name', () => {
    expect(getClientNameForLead(null, [])).toBe('Interno');
  });

  it('resolves a name from an explicitly-passed clients list (the canonical registry)', () => {
    const clients = [{ id: 'client-acme', name: 'Acme Co' }];
    expect(getClientNameForLead('client-acme', clients)).toBe('Acme Co');
  });

  it('returns an honest "Cliente desconocido" for a clientId not in the given list', () => {
    expect(getClientNameForLead('client-does-not-exist', [])).toBe('Cliente desconocido');
  });
});
