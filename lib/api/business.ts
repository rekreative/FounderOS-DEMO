import type { InternalBusinessWorkspace, SaveInternalBusinessWorkspaceInput } from '@/lib/business';
import { apiFetch } from './http';

export async function getInternalBusinessWorkspace(): Promise<InternalBusinessWorkspace> {
  return apiFetch<InternalBusinessWorkspace>('/api/business');
}

export async function saveInternalBusinessWorkspace(
  input: SaveInternalBusinessWorkspaceInput,
): Promise<InternalBusinessWorkspace> {
  return apiFetch<InternalBusinessWorkspace>('/api/business', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
