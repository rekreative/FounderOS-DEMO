import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const db = getDb();
    return NextResponse.json({ departments: db.departments.all() });
  } catch (error) {
    return unexpectedError('GET /api/departments', error);
  }
}
