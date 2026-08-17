export type ClientStatus = 'active' | 'paused' | 'prospect';

export interface Client {
  id: string;
  name: string;
  sector: string;
  status: ClientStatus;
  service: string;
  metaBudgetMonthly: number;
  startDate: string; // ISO
  owner: string;
  createdAt?: string;
}

const STORAGE_KEY = 'rek_clients_v1_seeded_v1';

// Seed / demo data — intentionally obvious to be replaced by real DB later
const SEED_CLIENTS: Client[] = [
  {
    id: 'client-acme',
    name: 'Acme Co',
    sector: 'E-commerce',
    status: 'active',
    service: 'Full-funnel Meta Ads',
    metaBudgetMonthly: 5000,
    startDate: '2026-01-05',
    owner: 'Jane Doe',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'client-northwind',
    name: 'Northwind Ltd',
    sector: 'SaaS',
    status: 'paused',
    service: 'Brand + Ads',
    metaBudgetMonthly: 2500,
    startDate: '2026-03-01',
    owner: 'John Smith',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'client-lumen',
    name: 'Lumen Studio',
    sector: 'Creative Agency',
    status: 'prospect',
    service: 'Consulting',
    metaBudgetMonthly: 0,
    startDate: '2026-07-01',
    owner: 'Ana Ruiz',
    createdAt: new Date().toISOString(),
  },
];

function readStorage(): Client[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Client[];
  } catch (e) {
    console.error('Failed to parse clients from localStorage', e);
    return [];
  }
}

function writeStorage(clients: Client[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  } catch (e) {
    console.error('Failed to write clients to localStorage', e);
  }
}

export function initializeStoreIfNeeded(): Client[] {
  if (typeof window === 'undefined') return SEED_CLIENTS;
  const existing = readStorage();
  if (!existing || existing.length === 0) {
    writeStorage(SEED_CLIENTS);
    return SEED_CLIENTS;
  }
  return existing;
}

export function getClients(): Client[] {
  return readStorage();
}

export function getClientById(id: string): Client | null {
  const all = readStorage();
  return all.find((c) => c.id === id) ?? null;
}

export function createClient(input: Omit<Client, 'id' | 'createdAt'>): Client {
  const id = `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
  const client: Client = { ...input, id, createdAt: new Date().toISOString() };
  const all = readStorage();
  const next = [client, ...all];
  writeStorage(next);
  return client;
}

export function updateClient(id: string, patch: Partial<Client>): Client | null {
  const all = readStorage();
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated = { ...all[idx], ...patch };
  all[idx] = updated;
  writeStorage(all);
  return updated;
}

export function deleteClient(id: string): boolean {
  const all = readStorage();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  writeStorage(next);
  deleteClientNotes(id); // Also delete associated notes
  return true;
}

// Export seed for server-side or tests if needed
export function getSeedClients(): Client[] {
  return SEED_CLIENTS.slice();
}

// ===== NOTES STORAGE (separate from Client model) =====

const NOTES_STORAGE_KEY = 'rek_client_notes_v1';

function readNotes(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch (e) {
    console.error('Failed to parse notes from localStorage', e);
    return {};
  }
}

function writeNotes(notes: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch (e) {
    console.error('Failed to write notes to localStorage', e);
  }
}

export function getClientNotes(clientId: string): string {
  const notes = readNotes();
  return notes[clientId] ?? '';
}

export function updateClientNotes(clientId: string, content: string): void {
  const notes = readNotes();
  notes[clientId] = content;
  writeNotes(notes);
}

export function deleteClientNotes(clientId: string): void {
  const notes = readNotes();
  delete notes[clientId];
  writeNotes(notes);
}
