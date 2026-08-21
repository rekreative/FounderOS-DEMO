import { NextResponse } from 'next/server';
import { LeadNotFoundError, appendLeadEvent, getLeadById, listLeadEvents } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { AppendManualEventBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

/** GET → the ordered timeline (occurred_at, then created_at, then id). */
export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const lead = await getLeadById(params.id);
    if (!lead) return jsonError(404, 'lead not found');
    const events = await listLeadEvents(params.id);
    return NextResponse.json({ events });
  } catch (error) {
    return unexpectedError('GET /api/leads/[id]/events', error);
  }
}

/**
 * POST — manual note only. This is the browser-facing surface, so it never
 * accepts a caller-supplied `type`/`source`: that would let the browser
 * spoof an automated event (whatsapp_sent, converted, ai_analyzed, …). Every
 * event created here is hardcoded to type: 'manual_note', source: 'manual'
 * — matching the current "Añadir nota" UI in app/leads/page.tsx exactly.
 * The future Make/WhatsApp ingestion paths append events through
 * lib/server/leads-repo.ts directly from their own protected routes, not
 * through this one.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const parsed = AppendManualEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const event = await appendLeadEvent({
      leadId: params.id,
      type: 'manual_note',
      source: 'manual',
      summary: parsed.data.summary,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    return unexpectedError('POST /api/leads/[id]/events', error);
  }
}
