/**
 * Shared browser-facing fetch helper for lib/api/*. Centralizes JSON parsing
 * and error handling so every API client surfaces the server's own honest
 * `{ error }` message — never a raw DB error, never a generic "fetch failed".
 * Never imports anything server-only (no lib/server/*, no pg, no DATABASE_URL).
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // No/invalid JSON body — fall through to the status-code-only error below.
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

/** Runs `fn`; on a 404 ApiError, resolves to null instead of throwing — the
 *  common "get by id" shape across lib/api/clients.ts and lib/api/leads.ts. */
export async function nullOn404<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
