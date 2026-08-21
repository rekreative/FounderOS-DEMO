import { getClients } from '@/lib/clients';

// G-Brain V1 — REKREATIVE's structured institutional memory: decisions,
// learnings, SOPs, strategy, and client context, kept as typed searchable
// records. Deliberately separate from the legacy FounderOS G-Brain
// (lib/brain*.ts, lib/connectors/gbrain.ts, lib/knowledge-graph.ts,
// lib/memory-core.ts) — that system stays untouched, shells out to a real
// gbrain CLI + markdown brain-store, and now lives at /brain/legacy. This
// module owns none of that; it is its own localStorage store, same
// architecture as lib/content-items.ts and lib/agents-ai.ts.
//
// Also deliberately separate from Client Notes (lib/clients.ts's
// getClientNotes/updateClientNotes) — that's a single scratchpad string per
// client, this is structured/typed/tagged/searchable memory. No migration
// between the two exists in V1.

export const KNOWLEDGE_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'Interno · REKREATIVE' },
] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPE_OPTIONS)[number]['id'];

// Only two states — G-Brain is memory, not a task workflow. No draft/review.
export const KNOWLEDGE_STATUS_OPTIONS = [
  { id: 'active', label: 'Activo' },
  { id: 'archived', label: 'Archivado' },
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS_OPTIONS)[number]['id'];

// The controlled taxonomy — deliberately small and non-overlapping so a
// human actually picks the right one instead of guessing between near
// synonyms. Free tags (see normalizeTags) cover everything this can't.
export const KNOWLEDGE_TYPE_OPTIONS = [
  { id: 'decision', label: 'Decisión' },
  { id: 'learning', label: 'Aprendizaje' },
  { id: 'sop', label: 'SOP' },
  { id: 'strategy', label: 'Estrategia' },
  { id: 'client_context', label: 'Contexto de cliente' },
  { id: 'technical_note', label: 'Nota técnica' },
  { id: 'other', label: 'Otro' },
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPE_OPTIONS)[number]['id'];

// Provenance only — describes what the knowledge is *about*, never implies
// automatic ingestion. Every V1 entry is manually authored regardless of
// which source it names; 'system' is reserved, unused by any seed/manual
// entry, for a future real integration.
export const KNOWLEDGE_SOURCE_OPTIONS = [
  { id: 'manual', label: 'Manual' },
  { id: 'client', label: 'Cliente' },
  { id: 'campaign', label: 'Campaña' },
  { id: 'meeting', label: 'Reunión' },
  { id: 'analysis', label: 'Análisis' },
  { id: 'document', label: 'Documento' },
  { id: 'system', label: 'Sistema' },
  { id: 'other', label: 'Otro' },
] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCE_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * Same honesty rule as lib/content-items.ts's ContentDataSource — no
 * automatic ingestion exists, so nothing else is ever stamped here. */
export type KnowledgeDataSource = 'demo' | 'manual';

export type KnowledgeEntry = {
  id: string;

  scope: KnowledgeScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  title: string;
  type: KnowledgeType;
  /** Free tags — flexible context. KnowledgeType is the controlled taxonomy;
   * there is no second category field. */
  tags: string[];

  summary: string;
  content: string;

  source: KnowledgeSource;
  /** Optional human-readable provenance detail, e.g. "Reunión Acme —
   * 12/08/2026". Never implies automatic capture of that meeting/document. */
  sourceLabel: string | null;

  status: KnowledgeStatus;

  createdAt: string;
  updatedAt: string;

  dataSource: KnowledgeDataSource;
};

export type CreateKnowledgeEntryInput = {
  scope: KnowledgeScope;
  clientId?: string | null;
  title: string;
  type: KnowledgeType;
  tags?: string[];
  summary?: string;
  content?: string;
  source: KnowledgeSource;
  sourceLabel?: string | null;
  status?: KnowledgeStatus;
  dataSource?: KnowledgeDataSource;
};

export type UpdateKnowledgeEntryInput = Partial<Omit<KnowledgeEntry, 'id' | 'createdAt'>>;

const STORAGE_KEY = 'rek_knowledge_entries_v1';

// ===== RAW STORAGE (kept private to this module) =====

function readStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
    return [];
  }
}

function writeStorage<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Trim, drop empties, dedupe case-insensitively while keeping the first
 * casing seen — "Meta Ads" and "meta ads" collapse to one tag. */
export function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

// ===== SEED / DEMO DATA =====
// Intentionally obvious REKREATIVE-style demo knowledge, spread across
// internal + the seeded clients (client-acme, client-northwind, client-lumen
// — see lib/clients.ts). Covers most types/sources at least once and
// includes one archived entry, so the archive/restore + filter paths have
// something real to exercise out of the box.

function seedDemoKnowledgeEntries(): KnowledgeEntry[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  return [
    {
      id: 'knowledge-internal-sop-1',
      scope: 'internal',
      clientId: null,
      title: 'SOP: automatización de leads con Make + WhatsApp',
      type: 'sop',
      tags: ['automatizaciones', 'leads', 'whatsapp'],
      summary: 'Flujo estándar para cualificar y enrutar leads entrantes de Meta Ads por WhatsApp usando Make.',
      content:
        '1) El lead entra por el formulario de Meta Ads y dispara un webhook a Make.\n2) Make crea/actualiza el contacto en el CRM y envía el primer mensaje de WhatsApp.\n3) El Agente de Cualificación de Leads hace hasta 3 preguntas y clasifica frío/templado/caliente.\n4) Leads calientes se asignan a comercial en menos de 15 minutos; el resto entra en seguimiento automático a 48h.',
      source: 'manual',
      sourceLabel: null,
      status: 'active',
      createdAt: daysAgo(60),
      updatedAt: daysAgo(3),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-internal-strategy-1',
      scope: 'internal',
      clientId: null,
      title: 'Framework de cualificación de leads — Meta Ads',
      type: 'strategy',
      tags: ['meta-ads', 'leads', 'framework'],
      summary: 'Los 3 criterios que usamos para priorizar leads de Meta Ads antes de pasarlos a comercial: presupuesto, plazo, decisor.',
      content:
        'Cualificamos cada lead en tres ejes — presupuesto disponible, plazo de decisión y si hablamos con quien decide. Un lead "caliente" cumple los tres; "templado" cumple dos; el resto entra en nutrición. Este framework es el mismo que sigue el Agente de Cualificación de Leads en su prompt.',
      source: 'analysis',
      sourceLabel: null,
      status: 'active',
      createdAt: daysAgo(40),
      updatedAt: daysAgo(6),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-internal-learning-1',
      scope: 'internal',
      clientId: null,
      title: 'Aprendizaje: test de creatividades Q2',
      type: 'learning',
      tags: ['meta-ads', 'creatividad', 'testing'],
      summary: 'Los hooks en formato pregunta directa superaron en un 40% el CTR de los hooks afirmativos en el test del Q2.',
      content:
        'Durante el test de creatividades del Q2 comparamos hooks en formato pregunta ("¿Y si...?") contra afirmaciones directas. Las preguntas obtuvieron ~40% más CTR de media en Reels, especialmente en las primeras 48h de rotación. Aplicar como default en nuevos guiones salvo que el cliente pida lo contrario.',
      source: 'campaign',
      sourceLabel: 'Test de creatividades — Q2 2026',
      status: 'active',
      createdAt: daysAgo(25),
      updatedAt: daysAgo(2),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-internal-technical-1',
      scope: 'internal',
      clientId: null,
      title: 'Nota técnica: convención dataSource demo/manual',
      type: 'technical_note',
      tags: ['rekreative-os', 'arquitectura'],
      summary: 'Todos los módulos REKREATIVE V1 marcan cada registro como dataSource "demo" o "manual" — nunca "live" sin integración real.',
      content:
        'Cada store localStorage de REKREATIVE OS (clientes, contenido, agentes, automatizaciones, G-Brain...) estampa dataSource en cada registro: "demo" para datos sembrados, "manual" para lo introducido a mano en la UI. Ningún módulo V1 debe usar un valor que implique una integración en vivo que no existe.',
      source: 'document',
      sourceLabel: null,
      status: 'active',
      createdAt: daysAgo(15),
      updatedAt: daysAgo(15),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-internal-decision-1',
      scope: 'internal',
      clientId: null,
      title: 'Decisión: pausar el piloto de Webinars en directo',
      type: 'decision',
      tags: ['decisiones', 'contenido'],
      summary: 'Se pausa el formato de webinar en directo a favor del caso de estudio grabado — mejor ratio esfuerzo/alcance.',
      content:
        'Tras dos webinars en directo con asistencia baja, decidimos pausar el formato y priorizar el caso de estudio grabado (ver Contenido → "Caso de estudio — Proceso REKREATIVE"). Revisar la decisión si el catálogo de contenido evergreen se agota.',
      source: 'meeting',
      sourceLabel: 'Reunión semanal de contenido',
      status: 'archived',
      createdAt: daysAgo(50),
      updatedAt: daysAgo(18),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-acme-decision-1',
      scope: 'client',
      clientId: 'client-acme',
      title: 'Decisión de posicionamiento — Acme Co',
      type: 'decision',
      tags: ['posicionamiento', 'acme'],
      summary: 'Acme se posiciona como la opción "full-funnel" frente a agencias que solo gestionan medios — enfoque acordado con el cliente.',
      content:
        'En la reunión de posicionamiento, Acme confirmó que quiere diferenciarse de sus competidores enfocándose en el funnel completo (adquisición + conversión + retención), no solo en gestión de anuncios. Todo el contenido y los guiones de venta deben reforzar este ángulo.',
      source: 'meeting',
      sourceLabel: 'Reunión de posicionamiento — 12/06/2026',
      status: 'active',
      createdAt: daysAgo(45),
      updatedAt: daysAgo(4),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-northwind-learning-1',
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Aprendizaje de campaña — Northwind',
      type: 'learning',
      tags: ['campaña', 'linkedin'],
      summary: 'Las comparativas "antes/después" en LinkedIn generan más leads cualificados que los posts de producto para Northwind.',
      content:
        'La campaña de julio mostró que el formato comparativo ("con Northwind / sin Northwind") obtuvo más leads cualificados por euro invertido que los posts centrados solo en funcionalidades del producto. Priorizar este formato mientras el cliente esté activo.',
      source: 'campaign',
      sourceLabel: 'Campaña LinkedIn — julio 2026',
      status: 'active',
      createdAt: daysAgo(20),
      updatedAt: daysAgo(9),
      dataSource: 'demo',
    },
    {
      id: 'knowledge-lumen-context-1',
      scope: 'client',
      clientId: 'client-lumen',
      title: 'Contexto de onboarding — Lumen Studio',
      type: 'client_context',
      tags: ['onboarding', 'contexto'],
      summary: 'Lumen es un prospecto: aún en fase de consultoría, sin presupuesto de Meta Ads asignado todavía.',
      content:
        'Lumen Studio entró como prospecto para consultoría de posicionamiento. No tiene presupuesto de Meta Ads asignado (ver ficha de cliente). Prioridad: definir pilares de contenido y validar propuesta de valor antes de hablar de medios pagados.',
      source: 'client',
      sourceLabel: 'Onboarding inicial',
      status: 'active',
      createdAt: daysAgo(10),
      updatedAt: daysAgo(1),
      dataSource: 'demo',
    },
  ];
}

// ===== STORE INITIALIZATION =====

export function initializeKnowledgeStoreIfNeeded(): KnowledgeEntry[] {
  if (typeof window === 'undefined') {
    return seedDemoKnowledgeEntries();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoKnowledgeEntries();
    writeStorage(STORAGE_KEY, seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const existing: KnowledgeEntry[] = Array.isArray(parsed) ? parsed : [];
    return existing.length ? existing : seedDemoKnowledgeEntries();
  } catch (error) {
    console.error('Failed to parse knowledge entries from localStorage; leaving existing store intact.', error);
    return seedDemoKnowledgeEntries();
  }
}

// ===== READ =====

/** No clientId → every entry (internal + every client). A clientId → only
 * that client's entries (never internal, never another client's) — the
 * exact contract components/ClientKnowledgePanel.tsx relies on. */
export function getKnowledgeEntries(clientId?: string): KnowledgeEntry[] {
  const entries = readStorage<KnowledgeEntry>(STORAGE_KEY);
  const result = !clientId ? entries : entries.filter((entry) => entry.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getKnowledgeEntryById(id: string): KnowledgeEntry | null {
  return readStorage<KnowledgeEntry>(STORAGE_KEY).find((entry) => entry.id === id) ?? null;
}

// ===== SEARCH (client-side, no fuzzy matching, no embeddings) =====

/** Case-insensitive substring match across title, summary, content, and
 * tags. An empty/blank query returns every entry unfiltered. */
export function searchKnowledgeEntries(entries: KnowledgeEntry[], query: string): KnowledgeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => {
    if (entry.title.toLowerCase().includes(q)) return true;
    if (entry.summary.toLowerCase().includes(q)) return true;
    if (entry.content.toLowerCase().includes(q)) return true;
    if (entry.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ===== WRITE =====

function assertScopeInvariant(scope: KnowledgeScope, clientId: string | null): void {
  if (scope === 'client') {
    if (!clientId) {
      throw new Error('A client-scoped knowledge entry requires a clientId');
    }
    const clientExists = getClients().some((client) => client.id === clientId);
    if (!clientExists) {
      throw new Error('Cannot create knowledge entry for a missing client id');
    }
  }
}

export function createKnowledgeEntry(input: CreateKnowledgeEntryInput): KnowledgeEntry {
  const clientId = input.scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(input.scope, clientId);

  const now = isoNow();
  const created: KnowledgeEntry = {
    id: `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    clientId,
    title: input.title.trim(),
    type: input.type,
    tags: normalizeTags(input.tags),
    summary: input.summary?.trim() || '',
    content: input.content?.trim() || '',
    source: input.source,
    sourceLabel: input.sourceLabel?.trim() || null,
    status: input.status ?? 'active',
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const entries = readStorage<KnowledgeEntry>(STORAGE_KEY);
  writeStorage(STORAGE_KEY, [created, ...entries]);
  return created;
}

export function updateKnowledgeEntry(id: string, patch: UpdateKnowledgeEntryInput): KnowledgeEntry | null {
  const entries = readStorage<KnowledgeEntry>(STORAGE_KEY);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return null;

  const merged: KnowledgeEntry = { ...entries[index], ...patch };
  if (patch.tags) merged.tags = normalizeTags(patch.tags);

  // Scope change to internal must clear clientId; scope client must still
  // reference a real client — same single invariant lib/content-items.ts's
  // updateContentItem enforces on write.
  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  const updated: KnowledgeEntry = { ...merged, updatedAt: isoNow() };
  entries[index] = updated;
  writeStorage(STORAGE_KEY, entries);
  return updated;
}

/** No permanent delete in G-Brain V1 — knowledge is meant to survive.
 * Archiving is the only soft-remove path; archived entries stay retrievable
 * through getKnowledgeEntries/getKnowledgeEntryById and any "show archived"
 * filter. */
export function archiveKnowledgeEntry(id: string): KnowledgeEntry | null {
  return updateKnowledgeEntry(id, { status: 'archived' });
}

export function restoreKnowledgeEntry(id: string): KnowledgeEntry | null {
  return updateKnowledgeEntry(id, { status: 'active' });
}

// ===== DERIVED (never persisted) =====

export type KnowledgeEntriesSummary = {
  /** Active entries only — archived never counts toward any of these. */
  activeTotal: number;
  internal: number;
  client: number;
  /** Distinct clients with at least one active client-scoped entry. */
  clientsWithKnowledge: number;
  /** Active entries updated in the last 7 days. */
  recentlyUpdated: number;
};

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Aggregate KPI totals over a set of entries — callers recompute from
 * whatever set is currently filtered, same convention as
 * summarizeContentItems/summarizeAiAgents. Only honest, cheaply-derived
 * counts — never a quality/confidence/usefulness score. */
export function summarizeKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntriesSummary {
  const active = entries.filter((entry) => entry.status === 'active');
  const now = Date.now();
  const clientIds = new Set(
    active.filter((entry) => entry.scope === 'client' && entry.clientId).map((entry) => entry.clientId as string),
  );
  return {
    activeTotal: active.length,
    internal: active.filter((entry) => entry.scope === 'internal').length,
    client: active.filter((entry) => entry.scope === 'client').length,
    clientsWithKnowledge: clientIds.size,
    recentlyUpdated: active.filter((entry) => now - new Date(entry.updatedAt).getTime() <= RECENT_WINDOW_MS).length,
  };
}

// ===== LABELS =====

/** "REKREATIVE" alone for internal entries — not "Interno · REKREATIVE",
 * which reads redundantly once this label is combined with a source/type
 * label at the call site (e.g. "REKREATIVE · Análisis"). Client entries keep
 * their name plain, same as before. Presentation only — scope/clientId
 * themselves are untouched. */
export function getClientNameForKnowledgeEntry(clientId: string | null): string {
  if (!clientId) return 'REKREATIVE';
  const client = getClients().find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getKnowledgeScopeLabel(scope: KnowledgeScope): string {
  return KNOWLEDGE_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

export function getKnowledgeStatusLabel(status: KnowledgeStatus): string {
  return KNOWLEDGE_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getKnowledgeTypeLabel(type: KnowledgeType): string {
  return KNOWLEDGE_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

export function getKnowledgeSourceLabel(source: KnowledgeSource): string {
  return KNOWLEDGE_SOURCE_OPTIONS.find((option) => option.id === source)?.label ?? source;
}
