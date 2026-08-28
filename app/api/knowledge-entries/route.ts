import { NextResponse } from 'next/server';
import { createKnowledgeEntry, KnowledgeEntryValidationError, listKnowledgeEntries } from '@/lib/server/knowledge-entries-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateKnowledgeEntryBodySchema, ListKnowledgeEntriesQuerySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/knowledge-entries
 * GET /api/knowledge-entries?clientId=client-acme
 *
 * G-Brain Postgres V1 — the structured institutional knowledge store's new
 * PostgreSQL home, replacing lib/knowledge-entries.ts's browser-localStorage
 * KnowledgeEntry store. Internal-only, both directions: G-Brain has no
 * client-role UX anywhere in the app today (see app/(internal)/layout.tsx),
 * so unlike /api/revenue-records this never uses a tenant guard. clientId is
 * an optional content filter, not an authorization boundary — omitted means
 * the global board's contract (internal + every client's entries).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const parsed = ListKnowledgeEntriesQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  try {
    const entries = await listKnowledgeEntries({ clientId: parsed.data.clientId });
    return NextResponse.json({ entries });
  } catch (error) {
    return unexpectedError('GET /api/knowledge-entries', error);
  }
}

/** createdBy is set from the authenticated user's id, never accepted from the request body. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateKnowledgeEntryBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const entry = await createKnowledgeEntry({ ...parsed.data, createdBy: auth.user.id });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeEntryValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('POST /api/knowledge-entries', error);
  }
}
