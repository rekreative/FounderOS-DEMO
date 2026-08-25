import { NextResponse } from 'next/server';
import { allConnectorStatuses } from '@/lib/connectors';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const connections = await allConnectorStatuses();
  return NextResponse.json({ connections });
}
