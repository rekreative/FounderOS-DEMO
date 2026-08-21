import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, deleteClient, getClientById, getClients, updateClient } from '@/lib/api/clients';

// Unit tests for the browser-facing HTTP client — mocked global.fetch, no
// real network/DB needed. Verifies JSON/error handling never leaks a raw
// server error and that 404s resolve to null rather than throwing.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('lib/api/clients', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getClients unwraps the { clients } envelope', async () => {
    global.fetch = mockFetchOnce(200, { clients: [{ id: 'client-acme', name: 'Acme Co' }] });
    const clients = await getClients();
    expect(clients).toEqual([{ id: 'client-acme', name: 'Acme Co' }]);
    expect(global.fetch).toHaveBeenCalledWith('/api/clients', expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('getClientById resolves null on a 404 instead of throwing', async () => {
    global.fetch = mockFetchOnce(404, { error: 'client not found' });
    await expect(getClientById('client-does-not-exist')).resolves.toBeNull();
  });

  it('getClientById surfaces the server error message on other failures', async () => {
    global.fetch = mockFetchOnce(500, { error: 'internal server error' });
    await expect(getClientById('client-acme')).rejects.toThrow('internal server error');
  });

  it('createClient POSTs the input and returns the created client', async () => {
    const input = {
      name: 'New Co',
      sector: 'Testing',
      status: 'prospect' as const,
      service: 'x',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'me',
    };
    global.fetch = mockFetchOnce(201, { client: { id: 'client-new', ...input } });
    const client = await createClient(input);
    expect(client.id).toBe('client-new');
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('updateClient resolves null on a 404', async () => {
    global.fetch = mockFetchOnce(404, { error: 'client not found' });
    await expect(updateClient('client-does-not-exist', { owner: 'x' })).resolves.toBeNull();
  });

  it('deleteClient never throws on a 409 — resolves to a structured blocked result', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 409,
      json: async () => ({ error: 'client has existing leads and cannot be deleted', leadCount: 2 }),
    });
    await expect(deleteClient('client-acme')).resolves.toEqual({ outcome: 'blocked', leadCount: 2 });
  });

  it('deleteClient resolves not_found on a 404', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 404, json: async () => ({ error: 'client not found' }) });
    await expect(deleteClient('client-does-not-exist')).resolves.toEqual({ outcome: 'not_found' });
  });

  it('deleteClient resolves deleted on a 200', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true }) });
    await expect(deleteClient('client-acme')).resolves.toEqual({ outcome: 'deleted' });
  });

  it('deleteClient still throws (never leaking a raw body) on a genuinely unexpected status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ status: 500, json: async () => ({ error: 'internal server error' }) });
    await expect(deleteClient('client-acme')).rejects.toThrow('internal server error');
  });
});
