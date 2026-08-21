import { NextResponse } from 'next/server';

/** Consistent JSON error shape across every Backend V1 route. */
export function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * A raw pg error can mention column/table/constraint names — never forward
 * one to the client. Log it server-side (never the connection string; pg
 * errors don't carry it) and return a flat, honest 500.
 */
export function unexpectedError(context: string, error: unknown): Response {
  console.error(`[api] ${context}:`, error);
  return jsonError(500, 'internal server error');
}
