import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getLeadById: vi.fn(),
  setLeadStage: vi.fn(),
  appendLeadEvent: vi.fn(),
  appendCommercialEvent: vi.fn(),
}));

vi.mock('@/lib/server/api-auth', () => ({
  requireUserOrResponse: vi.fn().mockResolvedValue({
    user: { id: 'client-user', email: 'client@example.com', role: 'client' },
  }),
  canAccessClientScopedObject: (...args: unknown[]) => mocks.canAccess(...args),
}));

vi.mock('@/lib/server/leads-repo', () => {
  class LeadNotFoundError extends Error {}
  class LeadStageTransitionError extends Error {}
  class CommercialConversionValidationError extends Error {}
  return {
    LeadNotFoundError,
    LeadStageTransitionError,
    CommercialConversionValidationError,
    getLeadById: (...args: unknown[]) => mocks.getLeadById(...args),
    setLeadStage: (...args: unknown[]) => mocks.setLeadStage(...args),
    appendLeadEvent: (...args: unknown[]) => mocks.appendLeadEvent(...args),
    appendCommercialEvent: (...args: unknown[]) => mocks.appendCommercialEvent(...args),
    listLeadEvents: vi.fn(),
  };
});

vi.mock('@/lib/server/meta-capi-live', () => ({ dispatchMetaCapiLiveEvent: vi.fn() }));

const { POST: postStage } = await import('@/app/api/leads/[id]/stage/route');
const { POST: postNote } = await import('@/app/api/leads/[id]/events/route');
const { POST: postCommercial } = await import('@/app/api/leads/[id]/commercial-events/route');

const lead = { id: 'lead-a', clientId: 'client-a' };

describe('client lead mutation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLeadById.mockResolvedValue(lead);
  });

  it.each([
    ['stage', postStage, { stage: 'contacted' }, mocks.setLeadStage],
    ['note', postNote, { summary: 'Follow-up' }, mocks.appendLeadEvent],
    ['commercial event', postCommercial, { type: 'proposal_sent' }, mocks.appendCommercialEvent],
  ])('returns the same 404 for a %s on an ungranted tenant and performs no write', async (_label, handler, body, write) => {
    mocks.canAccess.mockResolvedValue(false);

    const response = await handler(
      new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
      { params: { id: lead.id } },
    );

    expect(response.status).toBe(404);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.canAccess).toHaveBeenCalledWith(expect.objectContaining({ role: 'client' }), 'client-a');
  });

  it('allows an assigned client to update stage, add a note and record a proposal', async () => {
    mocks.canAccess.mockResolvedValue(true);
    mocks.setLeadStage.mockResolvedValue({ lead: { ...lead, stage: 'contacted' }, event: { id: 'event-stage' } });
    mocks.appendLeadEvent.mockResolvedValue({ id: 'event-note' });
    mocks.appendCommercialEvent.mockResolvedValue({
      lead: { ...lead, stage: 'proposal_sent' },
      event: { id: 'event-proposal', occurredAt: '2026-09-18T09:00:00.000Z' },
    });

    const stageResponse = await postStage(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ stage: 'contacted' }) }),
      { params: { id: lead.id } },
    );
    const noteResponse = await postNote(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ summary: 'Follow-up' }) }),
      { params: { id: lead.id } },
    );
    const commercialResponse = await postCommercial(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ type: 'proposal_sent' }) }),
      { params: { id: lead.id } },
    );

    expect(stageResponse.status).toBe(200);
    expect(noteResponse.status).toBe(201);
    expect(commercialResponse.status).toBe(201);
    expect(mocks.setLeadStage).toHaveBeenCalledWith(lead.id, 'contacted', 'manual');
    expect(mocks.appendLeadEvent).toHaveBeenCalledWith(expect.objectContaining({ leadId: lead.id, type: 'manual_note' }));
    expect(mocks.appendCommercialEvent).toHaveBeenCalledWith(expect.objectContaining({ leadId: lead.id, type: 'proposal_sent' }));
  });
});
