import { NextResponse } from 'next/server';
import { createClientMetaAccount, listClientMetaAccounts } from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateClientMetaAccountBodySchema, ListClientMetaAccountsQuerySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * client_meta_accounts — the canonical clientId <-> Meta ad account mapping
 * (Meta Ads Real V1). Deliberately the minimal CRUD surface needed to onboard
 * a new client without direct SQL: create/list/update. No DELETE — a mapping
 * is retired via `active: false` (PATCH), preserving history (see
 * lib/server/meta-repo.ts's module doc comment).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const parsed = ListClientMetaAccountsQuerySchema.safeParse({ clientId: url.searchParams.get('clientId') ?? undefined });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  try {
    const accounts = await listClientMetaAccounts(parsed.data.clientId);
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
    if (isUniqueViolation(error)) return jsonError(422, 'this Meta ad account is already actively mapped to a client');
    return unexpectedError('POST /api/meta-ads/accounts', error);
  }
}
