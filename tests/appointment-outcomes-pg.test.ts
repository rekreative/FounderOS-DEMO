import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installTestDatabaseUrl } from './helpers/pg-test-env';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { createLead, getLeadById, listLeadEvents } from '@/lib/server/leads-repo';
import { POST } from '@/app/api/leads/commercial-events/route';

const testDatabase = installTestDatabaseUrl();
const key = 'local-appointment-outcomes-test-only';
const date = '2026-10-01T10:00:00.000Z';

describe.runIf(Boolean(testDatabase))('Appointment outcomes and receipts, isolated PostgreSQL', () => {
  const originalKey = process.env.MAKE_EVENTS_API_KEY;
  const leadIds: string[] = [];
  let clientId: string;
  beforeAll(async () => {
    process.env.MAKE_EVENTS_API_KEY = key;
    clientId = (await createClient({ name: 'Local appointment test', sector: 'Testing', status: 'prospect', service: 'Test', owner: 'Test', metaBudgetMonthly: 0, startDate: '2026-01-01' })).id;
  });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.MAKE_EVENTS_API_KEY;
    else process.env.MAKE_EVENTS_API_KEY = originalKey;
    if (leadIds.length) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [leadIds]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
    }
    if (clientId) await query('DELETE FROM clients WHERE id = $1', [clientId]);
    await closePool();
  });
  async function lead(scope: 'client' | 'internal' = 'client') {
    const result = await createLead({ scope, ...(scope === 'client' ? { clientId } : {}), name: 'Local test', stage: 'appointment', appointmentDate: date });
    leadIds.push(result.lead.id);
    return result.lead;
  }
  function send(leadId: string, type: string, extra: Record<string, unknown> = {}) {
    return POST(new Request('http://localhost/api/leads/commercial-events', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ leadId, type, externalEventId: `${leadId}|${type}`, ...extra }),
    }));
  }
  it('records confirmation once, preserving the booking and lead stage', async () => {
    const l = await lead();
    expect((await send(l.id, 'appointment_confirmed', { appointmentDate: date })).status).toBe(201);
    expect((await send(l.id, 'appointment_confirmed', { appointmentDate: date })).status).toBe(200);
    expect((await getLeadById(l.id))?.appointmentDate).toBe(date);
    expect((await getLeadById(l.id))?.stage).toBe('appointment');
    expect((await listLeadEvents(l.id)).filter(e => e.type === 'appointment_confirmed')).toHaveLength(1);
  });
  it.each(['appointment_cancelled', 'appointment_no_show'])('%s clears only the matching booking, never disqualifies', async type => {
    const l = await lead();
    expect((await send(l.id, type, { appointmentDate: date })).status).toBe(201);
    expect((await send(l.id, type, { appointmentDate: date })).status).toBe(200);
    expect((await getLeadById(l.id))?.appointmentDate).toBeNull();
    expect((await getLeadById(l.id))?.stage).toBe('appointment');
  });
  it.each(['appointment_cancelled', 'appointment_no_show'])('late %s cannot remove a newer booking', async type => {
    const l = await lead();
    expect((await send(l.id, type, { appointmentDate: '2026-09-01T10:00:00Z' })).status).toBe(201);
    expect((await getLeadById(l.id))?.appointmentDate).toBe(date);
  });
  it('retains a converted lead when a later calendar cancellation arrives', async () => {
    const l = await lead();
    await send(l.id, 'converted', { conversionValue: 20 });
    expect((await send(l.id, 'appointment_cancelled', { appointmentDate: date })).status).toBe(201);
    expect((await getLeadById(l.id))?.stage).toBe('converted');
  });
  it('records 17.50 once under concurrent retries, with an auditable receipt', async () => {
    const l = await lead();
    const responses = await Promise.all(Array.from({ length: 3 }, () => send(l.id, 'converted', { conversionValue: 17.5, collectedAmount: 17.5 })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
    const saved = await getLeadById(l.id);
    expect(saved?.stage).toBe('converted');
    expect(saved?.conversionValue).toBe(17.5);
    expect(saved?.conversionCollection?.totalCollected).toBe(17.5);
    expect(saved?.conversionCollection?.outstandingAmount).toBe(0);
    expect((await query('SELECT * FROM lead_payments WHERE lead_id=$1', [l.id])).rows).toHaveLength(1);
    expect((await listLeadEvents(l.id)).filter(e => e.type === 'payment_received')).toHaveLength(1);
    expect((await send(l.id, 'converted', { externalEventId: l.id + '|new-key', conversionValue: 20, collectedAmount: 20 })).status).toBe(422);
    expect((await getLeadById(l.id))?.conversionCollection?.totalCollected).toBe(17.5);
  });
  it('value-only conversions never fabricate a receipt', async () => {
    const l = await lead();
    expect((await send(l.id, 'converted', { conversionValue: 20 })).status).toBe(201);
    expect((await getLeadById(l.id))?.conversionCollection?.totalCollected).toBe(0);
    expect((await query('SELECT * FROM lead_payments WHERE lead_id=$1', [l.id])).rows).toHaveLength(0);
  });
  it('does not broaden internal service payment rules', async () => {
    const l = await lead('internal');
    expect((await send(l.id, 'converted', { conversionValue: 20, collectedAmount: 20 })).status).toBe(422);
    expect((await getLeadById(l.id))?.stage).toBe('appointment');
  });
  it('rejects reuse of another lead occurrence', async () => {
    const a = await lead(); const b = await lead();
    await send(a.id, 'appointment_confirmed', { appointmentDate: date });
    expect((await send(b.id, 'appointment_confirmed', { appointmentDate: date, externalEventId: `${a.id}|appointment_confirmed` })).status).toBe(409);
  });
});
