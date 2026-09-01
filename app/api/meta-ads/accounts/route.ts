import { NextResponse } from 'next/server';
import { createClientMetaAccount, listClientMetaAccounts } from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateClientMetaAccountBodySchema, ListClientMetaAccountsQuerySchema } from '@/lib/server/schemas';
import { requireClientAccessOrResponse, requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function isOwnershipOverlap(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01';
}

/**
 * client_meta_accounts — the canonical clientId <-> Meta ad account mapping
 * (Meta Ads Real V1). Deliberately the minimal CRUD surface needed to onboard
 * a new client without direct SQL: create/list/update. No DELETE — a mapping
 * is retired via `active: false` (PATCH), preserving history (see
 * lib/server/meta-repo.ts's module doc comment).
 *
 * GET is tenant-aware: internal may omit clientId to list every mapping; a
 * client-role caller must pass a clientId it holds a grant for — omitting
 * it is rejected, never falls through to every client's account mappings.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ListClientMetaAccountsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    ownerScope: url.searchParams.get('ownerScope') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  const auth = await requireClientAccessOrResponse(parsed.data.clientId);
  if ('response' in auth) return auth.response;

  try {
    const accounts = parsed.data.ownerScope
      ? await listClientMetaAccounts(parsed.data.clientId, parsed.data.ownerScope)
      : await listClientMetaAccounts(parsed.data.clientId);
    return NextResponse.json({ accounts });
  } catch (error) {
    return unexpectedError('GET /api/meta-ads/accounts', error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateClientMetaAccountBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const account = await createClientMetaAccount(parsed.data);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (isForeignKeyViolation(error)) return jsonError(422, 'unknown client id');
    if (isUniqueViolation(error) || isOwnershipOverlap(error)) {
      return jsonError(422, 'this Meta ad account already has an overlapping ownership mapping');
    }
    return unexpectedError('POST /api/meta-ads/accounts', error);
  }
}
