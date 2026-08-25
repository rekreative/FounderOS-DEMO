import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import type { SocialPlatform } from '@/lib/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const db = getDb();
  syncFromZernioConfig(db);
  const detail = platformDetail(db, params.platform as SocialPlatform);
  if (!detail) {
    return NextResponse.json({ error: `unknown platform: ${params.platform}` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
