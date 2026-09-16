import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import {
  CommercialEventIdempotencyConflictError,
  LeadStageTransitionError,
  LeadNotFoundError,
  appendCommercialEvent,
  createLead,
  getLeadById,
  listLeadEvents,
  setLeadStage,
} from '@/lib/server/leads-repo';
import { POST as postMakeEvent } from '@/app/api/leads/commercial-events/route';
import { POST as postManualEvent } from '@/app/api/leads/[id]/commercial-events/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();
const TEST_KEY = 'test-commercial-events-key-for-vitest';

describe.runIf(Boolean(TEST_DATABASE_URL))('Appointment + Commercial Lifecycle V1 (real PostgreSQL)', () => {
  const originalKey = process.env.MAKE_EVENTS_API_KEY;
  const createdLeadIds: string[] = [];
  const createdServiceIds: string[] = [];

  beforeAll(() => {
    process.env.MAKE_EVENTS_API_KEY = TEST_KEY;
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.MAKE_EVENTS_API_KEY;
    else process.env.MAKE_EVENTS_API_KEY = originalKey;
    await closePool();
  });

  afterEach(async () => {
    const ids = createdLeadIds.splice(0);
    if (ids.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [ids]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [ids]);
    }
    const serviceIds = createdServiceIds.splice(0);
    if (serviceIds.length > 0) await query('DELETE FROM internal_business_services WHERE id = ANY($1)', [serviceIds]);
  });

  async function makeLead(overrides: Partial<Parameters<typeof createLead>[0]> = {}) {
    const { lead } = await createLead({ scope: 'internal', name: 'Commercial Event Test Lead', ...overrides });
    createdLeadIds.push(lead.id);
    return lead;
  }

  function postMake(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TEST_KEY}` }) {
    return postMakeEvent(
      new Request('http://x/api/leads/commercial-events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );
  }

  function postManual(leadId: string, body: unknown) {
    return postManualEvent(
      new Request(`http://x/api/leads/${leadId}/commercial-events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: { id: leadId } },
    );
  }

  describe('Proposal sent V1', () => {
    it.each(['new', 'qualified', 'appointment', 'no_response'] as const)('advances %s to proposal with one semantic event', async (stage) => {
      const lead = await makeLead({ stage });
      const result = await postManual(lead.id, { type: 'proposal_sent' });
      expect(result.status).toBe(201);
      expect((await getLeadById(lead.id))?.stage).toBe('proposal_sent');
      const events = await listLeadEvents(lead.id);
      expect(events.filter(e => e.type === 'proposal_sent')).toHaveLength(1);
      expect(events.some(e => e.type === 'stage_changed' && e.details?.to === 'proposal_sent')).toBe(true);
    });

    it('serializes manual double clicks and keeps retries safe after conversion', async () => {
      const lead = await makeLead();
      const input = { leadId: lead.id, type: 'proposal_sent' as const, source: 'manual' as const, summary: 'Propuesta enviada' };
      const results = await Promise.all([appendCommercialEvent(input), appendCommercialEvent(input)]);
      expect(results.filter(r => r.deduped)).toHaveLength(1);
      expect(new Set(results.map(r => r.event.id)).size).toBe(1);
      await appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'Convertido' });
      expect((await appendCommercialEvent(input)).deduped).toBe(true);
      expect((await getLeadById(lead.id))?.stage).toBe('converted');
    });

    it('creating directly at proposal stage persists its history before later conversion', async () => {
      const lead = await makeLead({ stage: 'proposal_sent' });
      await postManual(lead.id, { type: 'converted' });
      expect((await listLeadEvents(lead.id)).filter(e => e.type === 'proposal_sent')).toHaveLength(1);
    });

    it('generic stage selection records the proposal without duplicating the quick action', async () => {
      const lead = await makeLead();
      await setLeadStage(lead.id, 'proposal_sent');
      await postManual(lead.id, { type: 'proposal_sent' });
      expect((await listLeadEvents(lead.id)).filter(e => e.type === 'proposal_sent')).toHaveLength(1);
    });

    it('late Calendar bookings/completions retain the proposal stage and still record the appointment', async () => {
      const lead = await makeLead();
      await postManual(lead.id, { type: 'proposal_sent' });
      const appointmentDate = '2026-10-01T10:00:00.000Z';
      for (const type of ['appointment_booked', 'appointment_completed'] as const) {
        const result = await appendCommercialEvent({ leadId: lead.id, type, source: 'make', summary: type, appointmentDate, externalEventId: lead.id + type });
        expect(result.lead.stage).toBe('proposal_sent');
      }
      expect((await getLeadById(lead.id))?.appointmentDate).toBe(appointmentDate);
    });

    it.each(['converted', 'disqualified'] as const)('rejects a new proposal on terminal %s', async (stage) => {
      const lead = await makeLead({ stage });
      await expect(appendCommercialEvent({ leadId: lead.id, type: 'proposal_sent', source: 'manual', summary: 'Propuesta' })).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect((await listLeadEvents(lead.id)).filter(e => e.type === 'proposal_sent')).toHaveLength(0);
    });

    it('supports Make identity retries and rejects an external identity assigned to another lead', async () => {
      const lead = await makeLead();
      const other = await makeLead();
      const body = { type: 'proposal_sent', leadId: lead.id, externalEventId: 'proposal-' + lead.id };
      expect((await postMake(body)).status).toBe(201);
      expect((await postMake(body)).status).toBe(200);
      expect((await postMake({ ...body, leadId: other.id })).status).toBe(409);
      expect((await getLeadById(other.id))?.stage).toBe('new');
      expect((await listLeadEvents(lead.id)).filter(e => e.type === 'proposal_sent')).toHaveLength(1);
    });

    it('a proposal can be discarded without generating revenue', async () => {
      const lead = await makeLead();
      await postManual(lead.id, { type: 'proposal_sent' });
      await postManual(lead.id, { type: 'disqualified' });
      const stored = await getLeadById(lead.id);
      expect(stored?.stage).toBe('disqualified');
      expect(stored?.conversionValue).toBeNull();
    });
  });

  // ── Repository primitive — direct coverage of the stage rules ──────────
  describe('appendCommercialEvent (repository)', () => {
    it.each(['new', 'contacted', 'no_response'] as const)('%s → qualified creates the semantic event and advances stage', async (startStage) => {
      const lead = await makeLead();
      if (startStage !== 'new') await setLeadStage(lead.id, startStage);

      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'qualified',
        source: 'make',
        summary: 'Lead qualified',
        externalEventId: `qualified-${startStage}`,
      });

      expect(result.lead.stage).toBe('qualified');
      expect(result.event.type).toBe('qualified');
      const events = await listLeadEvents(lead.id);
      expect(events.slice(-2).map((event) => event.type)).toEqual(['qualified', 'stage_changed']);
    });

    it('qualified → appointment → converted preserves the approved lifecycle', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'qualified',
        source: 'make',
        summary: 'Lead qualified',
        externalEventId: 'qualified-sequence',
      });
      const appointment = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'appointment-sequence',
        appointmentDate: '2026-09-15T10:00:00.000Z',
      });
      expect(appointment.lead.stage).toBe('appointment');

      const converted = await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'converted-sequence',
      });
      expect(converted.lead.stage).toBe('converted');
    });

    it('qualified → disqualified remains supported', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'qualified',
        source: 'make',
        summary: 'Lead qualified',
        externalEventId: 'qualified-before-disqualified',
      });
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'make',
        summary: 'Lead disqualified',
        externalEventId: 'disqualified-after-qualified',
      });
      expect(result.lead.stage).toBe('disqualified');
    });

    it('appointment_booked stores appointmentDate and moves new → appointment', async () => {
      const lead = await makeLead();
      const appointmentDate = new Date('2026-09-01T10:00:00.000Z').toISOString();
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'booking-1',
        appointmentDate,
      });
      expect(result.lead.appointmentDate).toBe(appointmentDate);
      expect(result.lead.stage).toBe('appointment');
      expect(result.event.type).toBe('appointment_booked');
      expect(result.deduped).toBe(false);

      const events = await listLeadEvents(lead.id);
      expect(events.map((e) => e.type)).toEqual(['lead_received', 'appointment_booked', 'stage_changed']);
    });

    it.each(['new', 'contacted', 'qualified', 'no_response'] as const)(
      'appointment_booked moves %s → appointment',
      async (startStage) => {
        const lead = await makeLead();
        await setLeadStage(lead.id, startStage);
        const result = await appendCommercialEvent({
          leadId: lead.id,
          type: 'appointment_booked',
          source: 'make',
          summary: 'Appointment booked',
          externalEventId: `booking-${startStage}`,
          appointmentDate: new Date().toISOString(),
        });
        expect(result.lead.stage).toBe('appointment');
      },
    );

    it('appointment_booked is rejected for an already-converted lead', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'conv-1',
      });
      await expect(
        appendCommercialEvent({
          leadId: lead.id,
          type: 'appointment_booked',
          source: 'make',
          summary: 'Appointment booked',
          externalEventId: 'booking-late',
          appointmentDate: new Date().toISOString(),
        }),
      ).rejects.toBeInstanceOf(LeadStageTransitionError);
      const events = await listLeadEvents(lead.id);
      expect(events.some((e) => e.type === 'appointment_booked')).toBe(false);
    });

    it('appointment_booked is rejected for an already-disqualified lead', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'make',
        summary: 'Lead disqualified',
        externalEventId: 'dq-1',
      });
      await expect(
        appendCommercialEvent({
          leadId: lead.id,
          type: 'appointment_booked',
          source: 'make',
          summary: 'Appointment booked',
          externalEventId: 'booking-late',
          appointmentDate: new Date().toISOString(),
        }),
      ).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect((await getLeadById(lead.id))?.stage).toBe('disqualified');
    });

    it('reschedule with a NEW externalEventId updates appointmentDate and keeps both events', async () => {
      const lead = await makeLead();
      const first = new Date('2026-09-01T10:00:00.000Z').toISOString();
      const second = new Date('2026-09-05T15:00:00.000Z').toISOString();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'booking-original',
        appointmentDate: first,
      });
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'booking-rescheduled',
        appointmentDate: second,
      });
      expect(result.lead.appointmentDate).toBe(second);
      const events = await listLeadEvents(lead.id);
      expect(events.filter((e) => e.type === 'appointment_booked')).toHaveLength(2);
    });

    it('duplicate appointment_booked with the SAME externalEventId does not update the date or duplicate the event', async () => {
      const lead = await makeLead();
      const first = new Date('2026-09-01T10:00:00.000Z').toISOString();
      const second = new Date('2026-09-05T15:00:00.000Z').toISOString();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'booking-fixed',
        appointmentDate: first,
      });
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked (retry)',
        externalEventId: 'booking-fixed',
        appointmentDate: second,
      });
      expect(result.deduped).toBe(true);
      expect(result.lead.appointmentDate).toBe(first);
      const events = await listLeadEvents(lead.id);
      expect(events.filter((e) => e.type === 'appointment_booked')).toHaveLength(1);
    });

    it.each(['new', 'contacted', 'qualified', 'no_response'] as const)(
      'appointment_completed moves %s → appointment',
      async (startStage) => {
        const lead = await makeLead();
        await setLeadStage(lead.id, startStage);
        const result = await appendCommercialEvent({
          leadId: lead.id,
          type: 'appointment_completed',
          source: 'make',
          summary: 'Appointment completed',
          externalEventId: `completed-${startStage}`,
        });
        expect(result.lead.stage).toBe('appointment');
      },
    );

    it('appointment_completed leaves an already-appointment lead unchanged', async () => {
      const lead = await makeLead();
      await setLeadStage(lead.id, 'appointment');
      const events0 = await listLeadEvents(lead.id);
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_completed',
        source: 'make',
        summary: 'Appointment completed',
        externalEventId: 'completed-1',
      });
      expect(result.lead.stage).toBe('appointment');
      const events1 = await listLeadEvents(lead.id);
      // Only the new appointment_completed event was appended — no extra stage_changed.
      expect(events1.length).toBe(events0.length + 1);
    });

    it('converted stores conversionValue when provided', async () => {
      const lead = await makeLead();
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'conv-1',
        conversionValue: 2500,
      });
      expect(result.lead.conversionValue).toBe(2500);
      expect(result.lead.stage).toBe('converted');
    });

    it('converted snapshots the selected service and payment agreement', async () => {
      const lead = await makeLead();
      const serviceId = `service-conversion-${Date.now()}`;
      createdServiceIds.push(serviceId);
      await query(
        `INSERT INTO internal_business_services
           (id, name, description, price, billing_type, allow_two_payments, second_payment_trigger, active, sort_order)
         VALUES ($1, 'Meta Ads launch', NULL, 600, 'one_off', true, 'At campaign launch', true, 0)`,
        [serviceId],
      );
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'Lead converted',
        conversionValue: 550,
        serviceId,
        paymentPlan: 'two_payments',
        initialPayment: 275,
      });
      expect(result.lead.conversionValue).toBe(550);
      expect(result.lead.conversionSnapshot).toMatchObject({
        serviceId,
        serviceName: 'Meta Ads launch',
        standardPrice: 600,
        paymentPlan: 'two_payments',
        initialPayment: 275,
      });
      expect(result.event.details).toMatchObject({ outstandingAmount: 275 });
    });

    it('converted without conversionValue succeeds and does not clear an existing value', async () => {
      const lead = await makeLead({ conversionValue: 900 });
      const result = await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'conv-2',
      });
      expect(result.lead.conversionValue).toBe(900);
      expect(result.lead.stage).toBe('converted');
    });

    it.each(['new', 'contacted', 'qualified', 'appointment', 'no_response'] as const)(
      'converted transitions %s → converted',
      async (startStage) => {
        const lead = await makeLead();
        await setLeadStage(lead.id, startStage);
        const result = await appendCommercialEvent({
          leadId: lead.id,
          type: 'converted',
          source: 'make',
          summary: 'Lead converted',
          externalEventId: `conv-${startStage}`,
        });
        expect(result.lead.stage).toBe('converted');
      },
    );

    it('converted is rejected for a disqualified lead without recording fields or events', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'make',
        summary: 'Lead disqualified',
        externalEventId: 'dq-1',
      });
      await expect(
        appendCommercialEvent({
          leadId: lead.id,
          type: 'converted',
          source: 'make',
          summary: 'Lead converted',
          externalEventId: 'conv-late',
          conversionValue: 100,
        }),
      ).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect((await getLeadById(lead.id))?.conversionValue).toBeNull();
      const events = await listLeadEvents(lead.id);
      expect(events.some((e) => e.type === 'converted')).toBe(false);
    });

    it.each(['new', 'contacted', 'qualified', 'appointment', 'no_response'] as const)(
      'disqualified transitions %s → disqualified',
      async (startStage) => {
        const lead = await makeLead();
        await setLeadStage(lead.id, startStage);
        const result = await appendCommercialEvent({
          leadId: lead.id,
          type: 'disqualified',
          source: 'make',
          summary: 'Lead disqualified',
          externalEventId: `dq-${startStage}`,
        });
        expect(result.lead.stage).toBe('disqualified');
      },
    );

    it('disqualified is rejected for an already-converted lead', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'conv-1',
      });
      await expect(
        appendCommercialEvent({
          leadId: lead.id,
          type: 'disqualified',
          source: 'make',
          summary: 'Lead disqualified',
          externalEventId: 'dq-late',
        }),
      ).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect((await getLeadById(lead.id))?.stage).toBe('converted');
      const events = await listLeadEvents(lead.id);
      expect(events.some((e) => e.type === 'disqualified')).toBe(false);
    });

    it('commercial event retries remain idempotent', async () => {
      const lead = await makeLead();
      const first = await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'make',
        summary: 'Lead disqualified',
        externalEventId: 'dup-1',
      });
      const second = await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'make',
        summary: 'Lead disqualified (retry)',
        externalEventId: 'dup-1',
      });
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.event.id).toBe(first.event.id);
      const events = await listLeadEvents(lead.id);
      expect(events.filter((e) => e.type === 'disqualified')).toHaveLength(1);
    });

    it('qualified retry with the same externalEventId and lead is idempotent', async () => {
      const lead = await makeLead();
      const input = {
        leadId: lead.id,
        type: 'qualified' as const,
        source: 'make' as const,
        summary: 'Lead qualified',
        externalEventId: 'qualified-retry',
      };
      const first = await appendCommercialEvent(input);
      const second = await appendCommercialEvent(input);
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.event.id).toBe(first.event.id);
    });

    it('qualified retry remains idempotent after the same lead later converts', async () => {
      const lead = await makeLead();
      const qualifiedInput = {
        leadId: lead.id,
        type: 'qualified' as const,
        source: 'make' as const,
        summary: 'Lead qualified',
        externalEventId: 'qualified-before-conversion-retry',
      };
      const first = await appendCommercialEvent(qualifiedInput);
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'make',
        summary: 'Lead converted',
        externalEventId: 'conversion-after-qualified',
      });

      const retry = await appendCommercialEvent(qualifiedInput);
      expect(retry.deduped).toBe(true);
      expect(retry.event.id).toBe(first.event.id);
      expect(retry.lead.stage).toBe('converted');
    });

    it('rejects reuse of type + externalEventId by another lead without mutating it', async () => {
      const firstLead = await makeLead({ name: 'First lead' });
      const secondLead = await makeLead({ name: 'Second lead' });
      await appendCommercialEvent({
        leadId: firstLead.id,
        type: 'qualified',
        source: 'make',
        summary: 'Lead qualified',
        externalEventId: 'qualified-cross-lead',
      });

      await expect(
        appendCommercialEvent({
          leadId: secondLead.id,
          type: 'qualified',
          source: 'make',
          summary: 'Lead qualified',
          externalEventId: 'qualified-cross-lead',
        }),
      ).rejects.toBeInstanceOf(CommercialEventIdempotencyConflictError);
      expect((await getLeadById(secondLead.id))?.stage).toBe('new');
      expect((await listLeadEvents(secondLead.id)).map((event) => event.type)).toEqual(['lead_received']);
    });

    it.each([
      ['converted', 'disqualified'],
      ['disqualified', 'converted'],
    ] as const)('rejects the incompatible terminal transition %s → %s before recording an event', async (startStage, eventType) => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: startStage,
        source: 'make',
        summary: `Lead ${startStage}`,
        externalEventId: `terminal-${startStage}`,
      });
      const before = await listLeadEvents(lead.id);

      await expect(
        appendCommercialEvent({
          leadId: lead.id,
          type: eventType,
          source: 'make',
          summary: `Lead ${eventType}`,
          externalEventId: `terminal-conflict-${eventType}`,
        }),
      ).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect(await listLeadEvents(lead.id)).toEqual(before);
    });

    it('the generic manual stage path cannot reopen a terminal lead', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'Lead converted',
      });
      await expect(setLeadStage(lead.id, 'qualified')).rejects.toBeInstanceOf(LeadStageTransitionError);
      expect((await getLeadById(lead.id))?.stage).toBe('converted');
    });

    it('the same externalEventId is allowed across different event types', async () => {
      const lead = await makeLead();
      const booked = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'make',
        summary: 'Appointment booked',
        externalEventId: 'shared-id',
        appointmentDate: new Date().toISOString(),
      });
      const completed = await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_completed',
        source: 'make',
        summary: 'Appointment completed',
        externalEventId: 'shared-id',
      });
      expect(booked.deduped).toBe(false);
      expect(completed.deduped).toBe(false);
    });

    it('throws LeadNotFoundError for an unknown lead', async () => {
      await expect(
        appendCommercialEvent({
          leadId: 'lead-does-not-exist',
          type: 'disqualified',
          source: 'make',
          summary: 'Lead disqualified',
          externalEventId: 'dq-ghost',
        }),
      ).rejects.toBeInstanceOf(LeadNotFoundError);
    });

    it('manual events (no externalEventId) are never deduped', async () => {
      const lead = await makeLead();
      const first = await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'manual',
        summary: 'Lead disqualified',
      });
      const second = await appendCommercialEvent({
        leadId: lead.id,
        type: 'disqualified',
        source: 'manual',
        summary: 'Lead disqualified again',
      });
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(false);
      expect(first.event.id).not.toBe(second.event.id);
    });
  });

  // ── POST /api/leads/commercial-events (Make) ────────────────────────────
  describe('POST /api/leads/commercial-events (Make)', () => {
    it('accepts an authenticated qualified event and rejects cross-lead key reuse with 409', async () => {
      const firstLead = await makeLead({ name: 'First API lead' });
      const secondLead = await makeLead({ name: 'Second API lead' });
      const body = { type: 'qualified', externalEventId: 'route-qualified-cross-lead' };

      const first = await postMake({ ...body, leadId: firstLead.id });
      expect(first.status).toBe(201);
      const retry = await postMake({ ...body, leadId: firstLead.id });
      expect(retry.status).toBe(200);
      expect((await retry.json()).deduped).toBe(true);
      const conflict = await postMake({ ...body, leadId: secondLead.id });
      expect(conflict.status).toBe(409);
      expect((await getLeadById(secondLead.id))?.stage).toBe('new');
    });

    it('accepts an authenticated appointment_booked, sourced "make"', async () => {
      const lead = await makeLead();
      const res = await postMake({
        type: 'appointment_booked',
        leadId: lead.id,
        externalEventId: 'route-booking-1',
        appointmentDate: new Date('2026-09-10T09:00:00.000Z').toISOString(),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; event: { source: string; type: string } };
      expect(body.ok).toBe(true);
      expect(body.event.source).toBe('make');
      expect(body.event.type).toBe('appointment_booked');
    });

    it('rejects a missing/invalid Authorization header', async () => {
      const lead = await makeLead();
      const res = await postMake(
        { type: 'disqualified', leadId: lead.id, externalEventId: 'auth-check' },
        { authorization: 'Bearer wrong-token' },
      );
      expect(res.status).toBe(401);
    });

    it('rejects a request with no Authorization header at all', async () => {
      const lead = await makeLead();
      const res = await postMakeEvent(
        new Request('http://x/api/leads/commercial-events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'disqualified', leadId: lead.id, externalEventId: 'no-auth' }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it('rejects appointment_booked with no appointmentDate', async () => {
      const lead = await makeLead();
      const res = await postMake({ type: 'appointment_booked', leadId: lead.id, externalEventId: 'missing-date' });
      expect(res.status).toBe(400);
    });

    it('rejects a body carrying a caller-supplied stage or source', async () => {
      const lead = await makeLead();
      const res = await postMake({
        type: 'disqualified',
        leadId: lead.id,
        externalEventId: 'spoof-attempt',
        stage: 'converted',
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown lead', async () => {
      const res = await postMake({ type: 'disqualified', leadId: 'lead-does-not-exist', externalEventId: 'ghost' });
      expect(res.status).toBe(404);
    });

    it('is idempotent on a retried delivery (deduped: true, 200)', async () => {
      const lead = await makeLead();
      const body = { type: 'converted' as const, leadId: lead.id, externalEventId: 'route-conv-1', conversionValue: 500 };
      const first = await postMake(body);
      expect(first.status).toBe(201);
      const second = await postMake(body);
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { deduped: boolean };
      expect(secondBody.deduped).toBe(true);
    });
  });

  // ── POST /api/leads/[id]/commercial-events (manual) ─────────────────────
  describe('POST /api/leads/[id]/commercial-events (manual)', () => {
    it('qualified creates a semantic event sourced manual', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'qualified' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { lead: { stage: string }; event: { source: string; type: string } };
      expect(body.lead.stage).toBe('qualified');
      expect(body.event).toMatchObject({ type: 'qualified', source: 'manual' });
    });

    it('appointment_booked creates a semantic event sourced "manual"', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, {
        type: 'appointment_booked',
        appointmentDate: new Date('2026-09-12T11:00:00.000Z').toISOString(),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { lead: { stage: string }; event: { source: string; type: string } };
      expect(body.event.source).toBe('manual');
      expect(body.event.type).toBe('appointment_booked');
      expect(body.lead.stage).toBe('appointment');
    });

    it('appointment_completed creates a semantic event', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'appointment_completed' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { event: { type: string } };
      expect(body.event.type).toBe('appointment_completed');
    });

    it('converted creates a semantic event with an optional value', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'converted', conversionValue: 1200 });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { lead: { conversionValue: number | null } };
      expect(body.lead.conversionValue).toBe(1200);
    });

    it('disqualified creates a semantic event', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'disqualified' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { lead: { stage: string } };
      expect(body.lead.stage).toBe('disqualified');
    });

    it('rejects a body carrying a caller-supplied stage or source', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'disqualified', source: 'make' });
      expect(res.status).toBe(400);
    });

    it('rejects a body carrying an externalEventId (manual never carries one)', async () => {
      const lead = await makeLead();
      const res = await postManual(lead.id, { type: 'disqualified', externalEventId: 'not-allowed' });
      expect(res.status).toBe(400);
    });

    it('does not require MAKE_EVENTS_API_KEY', async () => {
      const originalManualKey = process.env.MAKE_EVENTS_API_KEY;
      delete process.env.MAKE_EVENTS_API_KEY;
      try {
        const lead = await makeLead();
        const res = await postManual(lead.id, { type: 'disqualified' });
        expect(res.status).toBe(201);
      } finally {
        if (originalManualKey !== undefined) process.env.MAKE_EVENTS_API_KEY = originalManualKey;
      }
    });

    it('returns 404 for an unknown lead', async () => {
      const res = await postManual('lead-does-not-exist', { type: 'disqualified' });
      expect(res.status).toBe(404);
    });
  });

  // ── Regression: existing WhatsApp/Lead behavior untouched ───────────────
  describe('regression — existing Lead behavior is unaffected', () => {
    it('a lead created normally still starts at stage "new" with one lead_received event', async () => {
      const lead = await makeLead();
      expect(lead.stage).toBe('new');
      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('lead_received');
    });

    it('getLeadById still returns the lead unaffected by commercial-event helpers', async () => {
      const lead = await makeLead();
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'manual',
        summary: 'Appointment booked',
        appointmentDate: new Date().toISOString(),
      });
      const reloaded = await getLeadById(lead.id);
      expect(reloaded?.stage).toBe('appointment');
    });
  });
});
