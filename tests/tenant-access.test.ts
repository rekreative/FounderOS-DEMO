import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Runtime coverage for Tenant/API Authorization V1 — proves the actual
 * route handlers enforce the architecture, not just that they call the
 * right-named guard (tests/api-auth-inventory.test.ts covers that
 * structurally). Every scenario here needs to distinguish an internal
 * caller from a client-role caller with or without a real
 * user_client_access grant, so this file mocks identity
 * (@/lib/supabase/user) and the grant table (@/lib/server/profiles-repo)
 * and runs the REAL lib/server/auth.ts + lib/server/api-auth.ts chain on
 * top — the same pattern tests/auth.test.ts and
 * tests/api-internal-protection.test.ts already use.
 *
 * Critically: tests/setup.ts's global "always internal" mock
 * (vi.mock('@/lib/server/auth', ...)) would make every client-role
 * scenario below silently resolve as internal and pass for the wrong
 * reason — vi.unmock('@/lib/server/auth') below defeats that default for
 * this file specifically, so a client-role denial is actually exercised.
 *
 * Repo layers (leads/clients/results/meta-ads/ops-status) are mocked too —
 * this file has no real Postgres dependency, and only cares that the auth
 * decision is correct: which repo calls happen, with what filter, and what
 * status code a denial produces.
 */

const getSupabaseUser = vi.fn();
const getProfileRole = vi.fn();
const hasClientAccess = vi.fn();

vi.mock('@/lib/supabase/user', () => ({ getSupabaseUser: (...args: unknown[]) => getSupabaseUser(...args) }));
vi.mock('@/lib/server/profiles-repo', () => ({
  getProfileRole: (...args: unknown[]) => getProfileRole(...args),
  hasClientAccess: (...args: unknown[]) => hasClientAccess(...args),
}));
vi.unmock('@/lib/server/auth');

const listClients = vi.fn();
const createClient = vi.fn();
const getClientById = vi.fn();
const updateClient = vi.fn();
const deleteClient = vi.fn();
vi.mock('@/lib/server/clients-repo', () => ({
  listClients: (...args: unknown[]) => listClients(...args),
  createClient: (...args: unknown[]) => createClient(...args),
  getClientById: (...args: unknown[]) => getClientById(...args),
  updateClient: (...args: unknown[]) => updateClient(...args),
  deleteClient: (...args: unknown[]) => deleteClient(...args),
}));

const listLeads = vi.fn();
const createLead = vi.fn();
const getLeadById = vi.fn();
const updateLead = vi.fn();
const listLeadEvents = vi.fn();
const appendLeadEvent = vi.fn();
class LeadValidationError extends Error {}
class LeadNotFoundError extends Error {}
vi.mock('@/lib/server/leads-repo', () => ({
  listLeads: (...args: unknown[]) => listLeads(...args),
  createLead: (...args: unknown[]) => createLead(...args),
  getLeadById: (...args: unknown[]) => getLeadById(...args),
  updateLead: (...args: unknown[]) => updateLead(...args),
  listLeadEvents: (...args: unknown[]) => listLeadEvents(...args),
  appendLeadEvent: (...args: unknown[]) => appendLeadEvent(...args),
  LeadValidationError,
  LeadNotFoundError,
}));

const getResults = vi.fn();
vi.mock('@/lib/server/results-repo', () => ({ getResults: (...args: unknown[]) => getResults(...args) }));

const listClientMetaAccounts = vi.fn();
const createClientMetaAccount = vi.fn();
const getMetaSpendSummary = vi.fn();
const getMetaCampaignSummaries = vi.fn();
const getLatestSyncRun = vi.fn();
const getLatestSyncRunByOwnerScope = vi.fn();
const getMetaSpendSummaryByClient = vi.fn();
vi.mock('@/lib/server/meta-repo', () => ({
  listClientMetaAccounts: (...args: unknown[]) => listClientMetaAccounts(...args),
  createClientMetaAccount: (...args: unknown[]) => createClientMetaAccount(...args),
  getMetaSpendSummary: (...args: unknown[]) => getMetaSpendSummary(...args),
  getMetaCampaignSummaries: (...args: unknown[]) => getMetaCampaignSummaries(...args),
  getLatestSyncRun: (...args: unknown[]) => getLatestSyncRun(...args),
  getLatestSyncRunByOwnerScope: (...args: unknown[]) => getLatestSyncRunByOwnerScope(...args),
  getMetaSpendSummaryByClient: (...args: unknown[]) => getMetaSpendSummaryByClient(...args),
}));

const getClientOpsSnapshot = vi.fn();
vi.mock('@/lib/server/ops-status', () => ({ getClientOpsSnapshot: (...args: unknown[]) => getClientOpsSnapshot(...args) }));

const { GET: getClientsList } = await import('@/app/api/clients/route');
const { GET: getClientOne, PATCH: patchClient, DELETE: deleteClientRoute } = await import('@/app/api/clients/[id]/route');
const { GET: getLeadsList, POST: postLead } = await import('@/app/api/leads/route');
const { GET: getLeadOne, PATCH: patchLead } = await import('@/app/api/leads/[id]/route');
const { GET: getLeadEvents, POST: postLeadEvent } = await import('@/app/api/leads/[id]/events/route');
const { GET: getResultsRoute } = await import('@/app/api/results/route');
const { GET: getMetaCampaigns } = await import('@/app/api/meta-ads/campaigns/route');
const { GET: getMetaAccounts, POST: postMetaAccount } = await import('@/app/api/meta-ads/accounts/route');
const { GET: getOpsStatusClient } = await import('@/app/api/ops/status/client/[clientId]/route');

const SESSION_USER = { id: 'user-1', email: 'someone@rekreative.com' };

function asInternal() {
  getSupabaseUser.mockResolvedValue({ data: { user: SESSION_USER }, error: null });
  getProfileRole.mockResolvedValue('internal');
}

function asClient(granted: boolean) {
  getSupabaseUser.mockResolvedValue({ data: { user: SESSION_USER }, error: null });
  getProfileRole.mockResolvedValue('client');
  hasClientAccess.mockResolvedValue(granted);
}

beforeEach(() => {
  vi.clearAllMocks();
  listClients.mockResolvedValue([]);
  getClientById.mockResolvedValue(null);
  listLeads.mockResolvedValue([]);
  getLeadById.mockResolvedValue(null);
  listLeadEvents.mockResolvedValue([]);
  getResults.mockResolvedValue({ funnel: [] });
  listClientMetaAccounts.mockResolvedValue([]);
  getMetaSpendSummary.mockResolvedValue(null);
  getMetaCampaignSummaries.mockResolvedValue([]);
  getLatestSyncRun.mockResolvedValue(null);
  getLatestSyncRunByOwnerScope.mockResolvedValue(null);
  getMetaSpendSummaryByClient.mockResolvedValue(new Map());
  getClientOpsSnapshot.mockResolvedValue({ automations: [], agents: [] });
});

describe('GET /api/clients stays internal-only', () => {
  it('client role → 403, never reaches listClients', async () => {
    asClient(true);
    const res = await getClientsList();
    expect(res.status).toBe(403);
    expect(listClients).not.toHaveBeenCalled();
  });

  it('internal → 200', async () => {
    asInternal();
    const res = await getClientsList();
    expect(res.status).toBe(200);
    expect(listClients).toHaveBeenCalled();
  });
});

describe('GET /api/clients/[id] — object-scoped, cross-tenant denial is 404', () => {
  const getOne = (id: string) => getClientOne(new Request(`http://x/api/clients/${id}`), { params: { id } });

  it('internal → 200 for a real id', async () => {
    asInternal();
    getClientById.mockResolvedValue({ id: 'client-acme', name: 'Acme' });
    expect((await getOne('client-acme')).status).toBe(200);
  });

  it('internal → 404 for an unknown id', async () => {
    asInternal();
    getClientById.mockResolvedValue(null);
    expect((await getOne('client-ghost')).status).toBe(404);
  });

  it('client with a grant for this exact client → 200', async () => {
    asClient(true);
    getClientById.mockResolvedValue({ id: 'client-acme', name: 'Acme' });
    const res = await getOne('client-acme');
    expect(res.status).toBe(200);
    expect(hasClientAccess).toHaveBeenCalledWith(SESSION_USER.id, 'client-acme');
  });

  it('client WITHOUT a grant → 404, not 403 — a denial must not confirm the client exists', async () => {
    asClient(false);
    getClientById.mockResolvedValue({ id: 'client-acme', name: 'Acme' });
    const res = await getOne('client-acme');
    expect(res.status).toBe(404);
  });

  it('PATCH/DELETE remain internal-only: client role → 403, repo mutation never called', async () => {
    asClient(true);
    const patchRes = await patchClient(new Request('http://x/api/clients/client-acme', { method: 'PATCH', body: '{}' }), {
      params: { id: 'client-acme' },
    });
    expect(patchRes.status).toBe(403);
    expect(updateClient).not.toHaveBeenCalled();

    const delRes = await deleteClientRoute(new Request('http://x/api/clients/client-acme', { method: 'DELETE' }), {
      params: { id: 'client-acme' },
    });
    expect(delRes.status).toBe(403);
    expect(deleteClient).not.toHaveBeenCalled();
  });
});

describe('GET /api/leads — list never falls through to global data when clientId is omitted', () => {
  const list = (qs = '') => getLeadsList(new Request(`http://x/api/leads${qs}`));

  it('internal + no clientId → 200, global list', async () => {
    asInternal();
    const res = await list();
    expect(res.status).toBe(200);
    expect(listLeads).toHaveBeenCalledWith(expect.objectContaining({ clientId: undefined }));
  });

  it('client + no clientId → 403, listLeads never called (no fallthrough to global)', async () => {
    asClient(true);
    const res = await list();
    expect(res.status).toBe(403);
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('client + clientId with a grant → 200, scoped to that clientId', async () => {
    asClient(true);
    const res = await list('?clientId=client-acme');
    expect(res.status).toBe(200);
    expect(hasClientAccess).toHaveBeenCalledWith(SESSION_USER.id, 'client-acme');
    expect(listLeads).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-acme' }));
  });

  it('client + clientId without a grant → 403, listLeads never called', async () => {
    asClient(false);
    const res = await list('?clientId=client-other');
    expect(res.status).toBe(403);
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('POST /api/leads remains internal-only: client role → 403', async () => {
    asClient(true);
    const res = await postLead(new Request('http://x/api/leads', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
    expect(createLead).not.toHaveBeenCalled();
  });
});

describe('GET /api/leads/[id] — object-scoped, clientId derived from the stored lead, never caller input', () => {
  const getOne = (id: string) => getLeadOne(new Request(`http://x/api/leads/${id}`), { params: { id } });

  it('internal → 200 for a client-scoped lead', async () => {
    asInternal();
    getLeadById.mockResolvedValue({ id: 'lead-1', clientId: 'client-acme' });
    expect((await getOne('lead-1')).status).toBe(200);
  });

  it('internal → 200 for an internal-scoped (clientId null) lead', async () => {
    asInternal();
    getLeadById.mockResolvedValue({ id: 'lead-2', clientId: null });
    expect((await getOne('lead-2')).status).toBe(200);
  });

  it('internal → 404 for an unknown lead id', async () => {
    asInternal();
    getLeadById.mockResolvedValue(null);
    expect((await getOne('lead-missing')).status).toBe(404);
  });

  it('client WITH a grant for the lead\'s stored clientId → 200', async () => {
    asClient(true);
    getLeadById.mockResolvedValue({ id: 'lead-1', clientId: 'client-acme' });
    const res = await getOne('lead-1');
    expect(res.status).toBe(200);
    expect(hasClientAccess).toHaveBeenCalledWith(SESSION_USER.id, 'client-acme');
  });

  it('client WITHOUT a grant for the lead\'s stored clientId → 404, not 403', async () => {
    asClient(false);
    getLeadById.mockResolvedValue({ id: 'lead-1', clientId: 'client-acme' });
    const res = await getOne('lead-1');
    expect(res.status).toBe(404);
  });

  it('client role + a lead whose clientId is null → 404, invisible regardless of any grant', async () => {
    asClient(true);
    getLeadById.mockResolvedValue({ id: 'lead-2', clientId: null });
    const res = await getOne('lead-2');
    expect(res.status).toBe(404);
    // Nothing to check a grant against — a null clientId short-circuits
    // before ever consulting user_client_access.
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('PATCH /api/leads/[id] remains internal-only: client role → 403', async () => {
    asClient(true);
    const res = await patchLead(new Request('http://x/api/leads/lead-1', { method: 'PATCH', body: '{}' }), {
      params: { id: 'lead-1' },
    });
    expect(res.status).toBe(403);
    expect(updateLead).not.toHaveBeenCalled();
  });
});

describe('GET /api/leads/[id]/events — scoped by the parent lead\'s stored clientId', () => {
  const getEvents = (id: string) => getLeadEvents(new Request(`http://x/api/leads/${id}/events`), { params: { id } });

  it('client with a grant for the lead\'s clientId → 200', async () => {
    asClient(true);
    getLeadById.mockResolvedValue({ id: 'lead-1', clientId: 'client-acme' });
    const res = await getEvents('lead-1');
    expect(res.status).toBe(200);
    expect(listLeadEvents).toHaveBeenCalledWith('lead-1');
  });

  it('client without a grant → 404, listLeadEvents never called', async () => {
    asClient(false);
    getLeadById.mockResolvedValue({ id: 'lead-1', clientId: 'client-acme' });
    const res = await getEvents('lead-1');
    expect(res.status).toBe(404);
    expect(listLeadEvents).not.toHaveBeenCalled();
  });

  it('client + a null-clientId (internal-scoped) lead → 404', async () => {
    asClient(true);
    getLeadById.mockResolvedValue({ id: 'lead-2', clientId: null });
    const res = await getEvents('lead-2');
    expect(res.status).toBe(404);
    expect(listLeadEvents).not.toHaveBeenCalled();
  });

  it('POST /api/leads/[id]/events remains internal-only: client role → 403', async () => {
    asClient(true);
    const res = await postLeadEvent(new Request('http://x/api/leads/lead-1/events', { method: 'POST', body: '{"summary":"x"}' }), {
      params: { id: 'lead-1' },
    });
    expect(res.status).toBe(403);
    expect(appendLeadEvent).not.toHaveBeenCalled();
  });
});

describe('GET /api/results — aggregate never falls through to global when clientId is omitted', () => {
  const get = (qs = '') => getResultsRoute(new Request(`http://x/api/results${qs}`));

  it('internal + no clientId → 200, global aggregate', async () => {
    asInternal();
    const res = await get();
    expect(res.status).toBe(200);
    expect(getResults).toHaveBeenCalledWith(expect.objectContaining({ clientId: undefined }));
  });

  it('client + no clientId → 403, getResults never called', async () => {
    asClient(true);
    const res = await get();
    expect(res.status).toBe(403);
    expect(getResults).not.toHaveBeenCalled();
  });

  it('client + clientId with a grant → 200, scoped', async () => {
    asClient(true);
    const res = await get('?clientId=client-acme');
    expect(res.status).toBe(200);
    expect(getResults).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-acme' }));
  });

  it('client + clientId without a grant → 403', async () => {
    asClient(false);
    const res = await get('?clientId=client-other');
    expect(res.status).toBe(403);
    expect(getResults).not.toHaveBeenCalled();
  });

});

describe('GET /api/meta-ads/campaigns — aggregate never falls through to the global byClient breakdown', () => {
  const get = (qs = '') => getMetaCampaigns(new Request(`http://x/api/meta-ads/campaigns${qs}`));

  it('internal + no clientId → 200, global byClient breakdown computed', async () => {
    asInternal();
    const res = await get();
    expect(res.status).toBe(200);
    expect(getMetaSpendSummaryByClient).toHaveBeenCalled();
  });

  it('client + no clientId → 403, no meta-ads data functions called', async () => {
    asClient(true);
    const res = await get();
    expect(res.status).toBe(403);
    expect(getMetaSpendSummaryByClient).not.toHaveBeenCalled();
    expect(listClientMetaAccounts).not.toHaveBeenCalled();
  });

  it('client + clientId with a grant → 200, scoped to that client only', async () => {
    asClient(true);
    const res = await get('?clientId=client-acme');
    expect(res.status).toBe(200);
    expect(listClientMetaAccounts).toHaveBeenCalledWith('client-acme');
    expect(getMetaSpendSummaryByClient).not.toHaveBeenCalled();
  });

  it('client + clientId without a grant → 403', async () => {
    asClient(false);
    const res = await get('?clientId=client-other');
    expect(res.status).toBe(403);
  });

  it('internal + ownerScope=internal returns only internal reporting', async () => {
    asInternal();
    const res = await get('?ownerScope=internal');
    expect(res.status).toBe(200);
    expect(listClientMetaAccounts).toHaveBeenCalledWith(undefined, 'internal');
    expect(getMetaSpendSummary).toHaveBeenCalledWith(expect.objectContaining({ ownerScope: 'internal' }));
    expect(getMetaSpendSummaryByClient).not.toHaveBeenCalled();
  });

  it('client + ownerScope=internal is forbidden', async () => {
    asClient(true);
    const res = await get('?ownerScope=internal');
    expect(res.status).toBe(403);
    expect(listClientMetaAccounts).not.toHaveBeenCalled();
  });
});

describe('GET /api/meta-ads/accounts — list never falls through to every client\'s mappings', () => {
  const get = (qs = '') => getMetaAccounts(new Request(`http://x/api/meta-ads/accounts${qs}`));

  it('internal + no clientId → 200, lists every mapping', async () => {
    asInternal();
    const res = await get();
    expect(res.status).toBe(200);
    expect(listClientMetaAccounts).toHaveBeenCalledWith(undefined);
  });

  it('client + no clientId → 403, listClientMetaAccounts never called', async () => {
    asClient(true);
    const res = await get();
    expect(res.status).toBe(403);
    expect(listClientMetaAccounts).not.toHaveBeenCalled();
  });

  it('client + clientId with a grant → 200, scoped', async () => {
    asClient(true);
    const res = await get('?clientId=client-acme');
    expect(res.status).toBe(200);
    expect(listClientMetaAccounts).toHaveBeenCalledWith('client-acme');
  });

  it('internal + ownerScope=internal lists only internal mappings', async () => {
    asInternal();
    const res = await get('?ownerScope=internal');
    expect(res.status).toBe(200);
    expect(listClientMetaAccounts).toHaveBeenCalledWith(undefined, 'internal');
  });

  it('client + ownerScope=internal is forbidden', async () => {
    asClient(true);
    const res = await get('?ownerScope=internal');
    expect(res.status).toBe(403);
    expect(listClientMetaAccounts).not.toHaveBeenCalled();
  });

  it('POST /api/meta-ads/accounts remains internal-only: client role → 403', async () => {
    asClient(true);
    const res = await postMetaAccount(new Request('http://x/api/meta-ads/accounts', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
    expect(createClientMetaAccount).not.toHaveBeenCalled();
  });
});

describe('GET /api/ops/status/client/[clientId] — clientId IS the object; cross-tenant denial is 404', () => {
  const get = (clientId: string) => getOpsStatusClient(new Request(`http://x/api/ops/status/client/${clientId}`), { params: { clientId } });

  it('internal + an unknown/garbage clientId → still 200, neutral snapshot (never a 404 for internal)', async () => {
    asInternal();
    const res = await get('client-does-not-exist');
    expect(res.status).toBe(200);
  });

  it('client with a grant for this clientId → 200', async () => {
    asClient(true);
    const res = await get('client-acme');
    expect(res.status).toBe(200);
    expect(hasClientAccess).toHaveBeenCalledWith(SESSION_USER.id, 'client-acme');
  });

  it('client WITHOUT a grant → 404, not the neutral 200 an internal caller would get', async () => {
    asClient(false);
    const res = await get('client-acme');
    expect(res.status).toBe(404);
    expect(getClientOpsSnapshot).not.toHaveBeenCalled();
  });
});

describe('unauthenticated callers are rejected before any tenant logic runs', () => {
  beforeEach(() => {
    getSupabaseUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('GET /api/leads/[id] → 401, getLeadById never called', async () => {
    const res = await getLeadOne(new Request('http://x/api/leads/lead-1'), { params: { id: 'lead-1' } });
    expect(res.status).toBe(401);
    expect(getLeadById).not.toHaveBeenCalled();
  });

  it('GET /api/ops/status/client/[clientId] → 401, getClientOpsSnapshot never called', async () => {
    const res = await getOpsStatusClient(new Request('http://x/api/ops/status/client/client-acme'), { params: { clientId: 'client-acme' } });
    expect(res.status).toBe(401);
    expect(getClientOpsSnapshot).not.toHaveBeenCalled();
  });
});
