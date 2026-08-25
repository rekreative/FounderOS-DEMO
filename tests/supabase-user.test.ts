import { describe, expect, it, vi } from 'vitest';

const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
const getSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: () => ({ auth: { getUser, getSession } }),
}));

const { getSupabaseUser } = await import('@/lib/supabase/user');

describe('getSupabaseUser', () => {
  it('calls auth.getUser(), which revalidates against Supabase, never auth.getSession(), which only decodes the cookie', async () => {
    const result = await getSupabaseUser();

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { user: { id: 'user-1' } }, error: null });
  });
});
