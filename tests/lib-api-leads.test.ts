import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendLeadEvent,
  createLead,
  getLeadById,
  getLeadEvents,
  getLeads,
  setLeadStage,
  updateLead,
} from '@/lib/api/leads';

// Unit tests for the browser-facing HTTP client — mocked global.fetch, no
// real network/DB needed.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('lib/api/leads', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getLeads() with no options hits the bare endpoint', async () => {
    global.fetch = mockFetchOnce(200, { leads: [] });
    await getLeads();
    expect(global.fetch).toHaveBeenCalledWith('/api/leads', expect.any(Object));
  });

  it('getLeads({ scope }) builds the query string', async () => {
    global.fetch = mockFetchOnce(200, { leads: [] });
    await getLeads({ scope: 'internal' });
    expect(global.fetch).toHaveBeenCalledWith('/api/leads?scope=internal', expect.any(Object));
  });

  it('getLeads({ clientId }) builds the query string', async () => {
    global.fetch = mockFetchOnce(200, { leads: [] });
    await getLeads({ clientId: 'client-acme' });
    expect(global.fetch).toHaveBeenCalledWith('/api/leads?clientId=client-acme', expect.any(Object));
  });

  it('getLeadById resolves null on a 404', async () => {
    global.fetch = mockFetchOnce(404, { error: 'lead not found' });
    await expect(getLeadById('lead-does-not-exist')).resolves.toBeNull();
  });

  it('createLead POSTs and returns { lead, event }', async () => {
    const payload = { lead: { id: 'lead-1', name: 'Test Lead' }, event: { id: 'evt-1', type: 'lead_received' } };
    global.fetch = mockFetchOnce(201, payload);
    const result = await createLead({ scope: 'internal', name: 'Test Lead' });
    expect(result).toEqual(payload);
  });

  it('createLead surfaces a 422 domain error message rather than a generic failure', async () => {
    global.fetch = mockFetchOnce(422, { error: 'Cannot create lead for a missing client id', code: 'CLIENT_NOT_FOUND' });
    await expect(createLead({ scope: 'client', clientId: 'nope', name: 'X' })).rejects.toThrow(
      'Cannot create lead for a missing client id',
    );
  });

  it('updateLead resolves null on a 404', async () => {
    global.fetch = mockFetchOnce(404, { error: 'lead not found' });
    await expect(updateLead('lead-does-not-exist', { name: 'x' })).resolves.toBeNull();
  });

  it('setLeadStage posts the stage and resolves null on a 404', async () => {
    global.fetch = mockFetchOnce(404, { error: 'lead not found' });
    await expect(setLeadStage('lead-does-not-exist', 'qualified')).resolves.toBeNull();
  });

  it('setLeadStage returns { lead, event } on success', async () => {
    const payload = { lead: { id: 'lead-1', stage: 'qualified' }, event: { id: 'evt-2', type: 'stage_changed' } };
    global.fetch = mockFetchOnce(200, payload);
    await expect(setLeadStage('lead-1', 'qualified')).resolves.toEqual(payload);
  });

  it('getLeadEvents unwraps the { events } envelope', async () => {
    global.fetch = mockFetchOnce(200, { events: [{ id: 'evt-1' }] });
    await expect(getLeadEvents('lead-1')).resolves.toEqual([{ id: 'evt-1' }]);
  });

  it('appendLeadEvent only ever sends a summary — never a caller-chosen type/source', async () => {
    global.fetch = mockFetchOnce(201, { event: { id: 'evt-3', type: 'manual_note', source: 'manual' } });
    await appendLeadEvent('lead-1', { summary: 'Called back' });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ summary: 'Called back' });
  });

  it('a request failure never leaks a raw body shape — surfaces the server error string', async () => {
    global.fetch = mockFetchOnce(500, { error: 'internal server error' });
    await expect(getLeads()).rejects.toThrow('internal server error');
  });
});
