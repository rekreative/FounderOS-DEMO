import { getClients } from '@/lib/clients';

// Content V1 — the REKREATIVE content production pipeline: real pieces
// (client or internal REKREATIVE) tracked idea → published. Deliberately
// separate from lib/content.ts (the FounderOS content-agent-crew helper,
// which stays untouched) — this module owns the ContentItem record itself.
// Same localStorage/scope-invariant architecture as
// lib/integration-connections.ts's IntegrationConnection: clientId is the
// only link to client identity, never a duplicated name/sector/service.
//
// Client existence is NOT verified against lib/clients.ts here (Content
// Truth V1) — that store is an obsolete localStorage mirror that stopped
// receiving writes once Clients cut over to PostgreSQL (lib/api/clients.ts),
// so it only ever "knows" the 3 original seed clients. Verifying against it
// silently broke content creation for every real client created since.
// Client existence for a client-scoped write is instead established
// structurally (a non-empty clientId) plus contextually — ClientContentPanel
// only ever renders inside a client workspace the caller already loaded from
// the real PostgreSQL client route. getClients() stays imported only for the
// legacy getClientNameForContentItem() display helper below, which has no
// active operational caller (see its own comment).

export const CONTENT_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'Interno · REKREATIVE' },
] as const;
export type ContentScope = (typeof CONTENT_SCOPE_OPTIONS)[number]['id'];

export const CONTENT_FORMAT_OPTIONS = [
  { id: 'reel', label: 'Reel' },
  { id: 'carousel', label: 'Carrusel' },
  { id: 'story', label: 'Historia' },
  { id: 'static_post', label: 'Publicación estática' },
  { id: 'video_long', label: 'Vídeo largo' },
  { id: 'blog', label: 'Blog' },
  { id: 'email', label: 'Email' },
  { id: 'other', label: 'Otro' },
] as const;
export type ContentFormat = (typeof CONTENT_FORMAT_OPTIONS)[number]['id'];

export const CONTENT_PLATFORM_OPTIONS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'blog', label: 'Blog' },
  { id: 'email', label: 'Email' },
  { id: 'internal', label: 'Interno' },
] as const;
export type ContentPlatform = (typeof CONTENT_PLATFORM_OPTIONS)[number]['id'];

// Single production-state axis — deliberately no separate scriptReady/
// recorded/edited booleans. A piece is in exactly one of these 7 states, so
// "is the script ready" / "has it been recorded" / "has it been edited" are
// answered by status position alone, never by a second contradictory field.
export const CONTENT_STATUS_OPTIONS = [
  { id: 'idea', label: 'Idea' },
  { id: 'scripting', label: 'Guion' },
  { id: 'recording', label: 'Grabación' },
  { id: 'editing', label: 'Edición' },
  { id: 'ready', label: 'Listo' },
  { id: 'published', label: 'Publicado' },
  { id: 'cancelled', label: 'Cancelado' },
] as const;
export type ContentStatus = (typeof CONTENT_STATUS_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * No 'live' — Content V1 has no publishing/scheduling integration, same
 * honesty rule as lib/integration-connections.ts's IntegrationDataSource. */
export type ContentDataSource = 'demo' | 'manual';

export type ContentItem = {
  id: string;

  scope: ContentScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  title: string;

  format: ContentFormat;
  platform: ContentPlatform;
  status: ContentStatus;

  /** Free-ish content pillar/category — not a rigid taxonomy in V1. */
  pillar: string | null;

  hook: string;
  angle: string;
  script: string;
  notes: string;

  owner: string;

  /** Planned/scheduled publication date (date-only, e.g. "2026-08-20").
   * Never "publishedAt" — V1 has no record of when something actually went
   * live, only when it's planned to. */
  plannedPublishDate: string | null;

  createdAt: string;
  updatedAt: string;

  dataSource: ContentDataSource;
};

export type CreateContentItemInput = {
  scope: ContentScope;
  clientId?: string | null;
  title: string;
  format: ContentFormat;
  platform: ContentPlatform;
  status?: ContentStatus;
  pillar?: string | null;
  hook?: string;
  angle?: string;
  script?: string;
  notes?: string;
  owner: string;
  plannedPublishDate?: string | null;
  dataSource?: ContentDataSource;
};

export type UpdateContentItemInput = Partial<Omit<ContentItem, 'id' | 'createdAt'>>;

const STORAGE_KEY = 'rek_content_items_v1';

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

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

// ===== SEED / DEMO DATA =====
// Intentionally obvious REKREATIVE-style demo content, spread across the
// seeded clients (client-acme, client-northwind, client-lumen — see
// lib/clients.ts) plus internal/REKREATIVE pieces. Covers every status at
// least once, including at least one overdue, one published, one cancelled,
// and one internal item.

function seedDemoContentItems(): ContentItem[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };
  const dateDaysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const dateDaysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const base = { dataSource: 'demo' as const };

  return [
    {
      id: 'content-acme-idea-1',
      scope: 'client',
      clientId: 'client-acme',
      title: 'Antes/después de un cliente Acme',
      format: 'reel',
      platform: 'instagram',
      status: 'idea',
      pillar: 'Prueba social',
      hook: '¿Y si tu inventario se vendiera solo?',
      angle: 'Testimonio real de un cliente de Acme con métricas de antes/después.',
      script: '',
      notes: 'Pendiente de confirmar qué cliente quiere participar.',
      owner: 'Marta Ibáñez',
      plannedPublishDate: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      ...base,
    },
    {
      id: 'content-acme-scripting-1',
      scope: 'client',
      clientId: 'client-acme',
      title: '3 errores al vender online',
      format: 'reel',
      platform: 'tiktok',
      status: 'scripting',
      pillar: 'Educativo',
      hook: 'El error #2 lo comete el 90% de las tiendas.',
      angle: 'Formato listicle rápido, gancho fuerte en los primeros 2s.',
      script: 'Guion en curso — hook y error 1 escritos, faltan error 2 y 3.',
      notes: '',
      owner: 'Marta Ibáñez',
      plannedPublishDate: dateDaysFromNow(9),
      createdAt: daysAgo(6),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-acme-ready-1',
      scope: 'client',
      clientId: 'client-acme',
      title: 'Carrusel: por qué Full-funnel',
      format: 'carousel',
      platform: 'instagram',
      status: 'ready',
      pillar: 'Posicionamiento',
      hook: 'Los anuncios no venden solos — el funnel sí.',
      angle: 'Explica el enfoque full-funnel de Acme en 6 slides.',
      script: '6 slides, texto final aprobado por el cliente.',
      notes: 'Diseño terminado, esperando fecha de publicación del cliente.',
      owner: 'Diego León',
      plannedPublishDate: dateDaysFromNow(3),
      createdAt: daysAgo(14),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-acme-published-1',
      scope: 'client',
      clientId: 'client-acme',
      title: 'Reel de lanzamiento — Oferta Nuevo Cliente',
      format: 'static_post',
      platform: 'facebook',
      status: 'published',
      pillar: 'Promoción',
      hook: 'Nueva oferta para clientes Acme.',
      angle: 'Post de lanzamiento acompañando la campaña de Meta Ads.',
      script: 'Copy final publicado.',
      notes: '',
      owner: 'Diego León',
      plannedPublishDate: dateDaysAgo(5),
      createdAt: daysAgo(20),
      updatedAt: daysAgo(5),
      ...base,
    },
    {
      id: 'content-northwind-recording-1',
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Vídeo de marca — Northwind SaaS',
      format: 'video_long',
      platform: 'youtube',
      status: 'recording',
      pillar: 'Marca',
      hook: 'Así gestiona Northwind su operación en un solo panel.',
      angle: 'Screencast + entrevista al fundador, guion cerrado.',
      script: 'Guion aprobado, grabación programada esta semana.',
      notes: '',
      owner: 'Sofía Ramos',
      plannedPublishDate: dateDaysFromNow(12),
      createdAt: daysAgo(10),
      updatedAt: daysAgo(2),
      ...base,
    },
    {
      id: 'content-northwind-editing-1',
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Reel — Onboarding en 60 segundos',
      format: 'reel',
      platform: 'instagram',
      status: 'editing',
      pillar: 'Producto',
      hook: 'De registro a primer resultado en menos de un minuto.',
      angle: 'Screen recording acelerado del producto con voz en off.',
      script: 'Grabado, en edición de ritmo y subtítulos.',
      notes: '',
      owner: 'Sofía Ramos',
      plannedPublishDate: dateDaysFromNow(6),
      createdAt: daysAgo(9),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-northwind-cancelled-1',
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Newsletter — Novedades trimestrales',
      format: 'email',
      platform: 'email',
      status: 'cancelled',
      pillar: null,
      hook: '',
      angle: 'Resumen trimestral de producto.',
      script: '',
      notes: 'Cancelado: Northwind está pausado, se retoma si vuelve a estar activo.',
      owner: 'Sofía Ramos',
      plannedPublishDate: null,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(9),
      ...base,
    },
    {
      id: 'content-northwind-overdue-1',
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Carrusel — Comparativa antes de la pausa',
      format: 'carousel',
      platform: 'linkedin',
      status: 'scripting',
      pillar: 'Educativo',
      hook: 'Lo que cambia cuando centralizas tu stack.',
      angle: 'Comparativa "con Northwind / sin Northwind".',
      script: 'Guion a medias, quedó parado cuando el cliente se pausó.',
      notes: 'Retomar o cancelar cuando el cliente reactive el contrato.',
      owner: 'Marta Ibáñez',
      plannedPublishDate: dateDaysAgo(11),
      createdAt: daysAgo(25),
      updatedAt: daysAgo(11),
      ...base,
    },
    {
      id: 'content-lumen-idea-1',
      scope: 'client',
      clientId: 'client-lumen',
      title: 'Historia — Detrás de cámaras del estudio',
      format: 'story',
      platform: 'instagram',
      status: 'idea',
      pillar: 'Marca',
      hook: 'Un día en el estudio Lumen.',
      angle: 'Serie de historias mostrando el proceso creativo.',
      script: '',
      notes: '',
      owner: 'Diego León',
      plannedPublishDate: null,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      ...base,
    },
    {
      id: 'content-lumen-ready-1',
      scope: 'client',
      clientId: 'client-lumen',
      title: 'Carrusel — Antes de contratar un estudio creativo',
      format: 'carousel',
      platform: 'linkedin',
      status: 'ready',
      pillar: 'Educativo',
      hook: '5 preguntas que deberías hacer antes de contratar.',
      angle: 'Guía práctica con la perspectiva de Lumen.',
      script: '5 slides, copy final aprobado.',
      notes: '',
      owner: 'Diego León',
      plannedPublishDate: dateDaysFromNow(2),
      createdAt: daysAgo(8),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-internal-idea-1',
      scope: 'internal',
      clientId: null,
      title: 'Reel — Detrás de cámaras del equipo',
      format: 'reel',
      platform: 'instagram',
      status: 'idea',
      pillar: 'Marca REKREATIVE',
      hook: 'Un día cualquiera en REKREATIVE.',
      angle: 'Serie mostrando cómo trabaja el equipo internamente.',
      script: '',
      notes: '',
      owner: 'Equipo REKREATIVE',
      plannedPublishDate: null,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      ...base,
    },
    {
      id: 'content-internal-scripting-1',
      scope: 'internal',
      clientId: null,
      title: 'Reel — Por qué contratar una agencia y no un freelance',
      format: 'reel',
      platform: 'tiktok',
      status: 'scripting',
      pillar: 'Posicionamiento',
      hook: 'La diferencia no es el precio, es la estructura.',
      angle: 'Comparativa directa desde la experiencia de REKREATIVE.',
      script: 'Hook y primer punto escritos, faltan los otros dos.',
      notes: '',
      owner: 'Marta Ibáñez',
      plannedPublishDate: dateDaysFromNow(7),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-internal-recording-1',
      scope: 'internal',
      clientId: null,
      title: 'Caso de estudio — Proceso REKREATIVE',
      format: 'video_long',
      platform: 'youtube',
      status: 'recording',
      pillar: 'Marca REKREATIVE',
      hook: 'Así trabajamos con cada cliente, paso a paso.',
      angle: 'Vídeo largo explicando el proceso de onboarding a cliente.',
      script: 'Guion cerrado, grabación en curso.',
      notes: '',
      owner: 'Equipo REKREATIVE',
      plannedPublishDate: dateDaysFromNow(15),
      createdAt: daysAgo(12),
      updatedAt: daysAgo(3),
      ...base,
    },
    {
      id: 'content-internal-editing-1',
      scope: 'internal',
      clientId: null,
      title: 'Carrusel — Cultura de equipo REKREATIVE',
      format: 'carousel',
      platform: 'linkedin',
      status: 'editing',
      pillar: 'Marca REKREATIVE',
      hook: 'Así es trabajar en REKREATIVE.',
      angle: 'Carrusel de reclutamiento mostrando cultura y valores.',
      script: 'Slides escritas, en edición de diseño.',
      notes: '',
      owner: 'Diego León',
      plannedPublishDate: dateDaysFromNow(4),
      createdAt: daysAgo(7),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-internal-ready-1',
      scope: 'internal',
      clientId: null,
      title: 'Carrusel — 5 señales de que necesitas Meta Ads',
      format: 'carousel',
      platform: 'instagram',
      status: 'ready',
      pillar: 'Educativo',
      hook: '¿Deberías estar invirtiendo en Meta Ads ya?',
      angle: 'Carrusel educativo de captación, listo para publicar.',
      script: '5 slides, copy final aprobado.',
      notes: '',
      owner: 'Sofía Ramos',
      plannedPublishDate: dateDaysFromNow(1),
      createdAt: daysAgo(9),
      updatedAt: daysAgo(1),
      ...base,
    },
    {
      id: 'content-internal-published-1',
      scope: 'internal',
      clientId: null,
      title: 'Blog — Cómo estructuramos un funnel de Meta Ads',
      format: 'blog',
      platform: 'blog',
      status: 'published',
      pillar: 'Educativo',
      hook: 'La estructura de funnel que usamos con todos nuestros clientes.',
      angle: 'Artículo largo explicando el enfoque full-funnel de la agencia.',
      script: 'Publicado en el blog de REKREATIVE.',
      notes: '',
      owner: 'Equipo REKREATIVE',
      plannedPublishDate: dateDaysAgo(20),
      createdAt: daysAgo(40),
      updatedAt: daysAgo(20),
      ...base,
    },
    {
      id: 'content-internal-cancelled-1',
      scope: 'internal',
      clientId: null,
      title: 'Vídeo — Webinar en directo',
      format: 'video_long',
      platform: 'youtube',
      status: 'cancelled',
      pillar: null,
      hook: '',
      angle: 'Webinar en directo sobre adquisición de clientes.',
      script: '',
      notes: 'Cancelado: se prioriza el caso de estudio grabado en su lugar.',
      owner: 'Equipo REKREATIVE',
      plannedPublishDate: null,
      createdAt: daysAgo(18),
      updatedAt: daysAgo(6),
      ...base,
    },
  ];
}

// ===== STORE INITIALIZATION =====

export function initializeContentStoreIfNeeded(): ContentItem[] {
  if (typeof window === 'undefined') {
    return seedDemoContentItems();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoContentItems();
    writeStorage(STORAGE_KEY, seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const existing: ContentItem[] = Array.isArray(parsed) ? parsed : [];
    return existing.length ? existing : seedDemoContentItems();
  } catch (error) {
    console.error('Failed to parse content items from localStorage; leaving existing store intact.', error);
    return seedDemoContentItems();
  }
}

// ===== READ =====

/** No clientId → every item (client + internal). A clientId → only that
 * client's items (never internal, never another client's) — the exact
 * contract Client Workspace's ClientContentPanel relies on. */
export function getContentItems(clientId?: string): ContentItem[] {
  const items = readStorage<ContentItem>(STORAGE_KEY);
  const result = !clientId ? items : items.filter((item) => item.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getContentItemById(id: string): ContentItem | null {
  return readStorage<ContentItem>(STORAGE_KEY).find((item) => item.id === id) ?? null;
}

// ===== WRITE =====

/** Structural check only — a client-scoped item must carry a non-empty
 * clientId. Does NOT verify the id against any client registry; see the
 * module comment above for why. */
function assertScopeInvariant(scope: ContentScope, clientId: string | null): void {
  if (scope === 'client' && !clientId) {
    throw new Error('A client-scoped content item requires a clientId');
  }
}

export function createContentItem(input: CreateContentItemInput): ContentItem {
  const clientId = input.scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(input.scope, clientId);

  const now = isoNow();
  const created: ContentItem = {
    id: `content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    clientId,
    title: input.title.trim(),
    format: input.format,
    platform: input.platform,
    status: input.status ?? 'idea',
    pillar: input.pillar?.trim() || null,
    hook: input.hook?.trim() || '',
    angle: input.angle?.trim() || '',
    script: input.script?.trim() || '',
    notes: input.notes?.trim() || '',
    owner: input.owner.trim(),
    plannedPublishDate: input.plannedPublishDate || null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const items = readStorage<ContentItem>(STORAGE_KEY);
  writeStorage(STORAGE_KEY, [created, ...items]);
  return created;
}

export function updateContentItem(id: string, patch: UpdateContentItemInput): ContentItem | null {
  const items = readStorage<ContentItem>(STORAGE_KEY);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const merged: ContentItem = { ...items[index], ...patch };

  // Scope change to internal must clear clientId; scope client must still
  // reference a real client — same single invariant lib/integration-
  // connections.ts's updateIntegrationConnection enforces on write.
  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  const updated: ContentItem = { ...merged, updatedAt: isoNow() };
  items[index] = updated;
  writeStorage(STORAGE_KEY, items);
  return updated;
}

export function setContentStatus(id: string, status: ContentStatus): ContentItem | null {
  return updateContentItem(id, { status });
}

export function deleteContentItem(id: string): boolean {
  const items = readStorage<ContentItem>(STORAGE_KEY);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  writeStorage(STORAGE_KEY, next);
  return true;
}

// ===== DERIVED (never persisted) =====

/** "Active" = anything still moving through production — everything except
 * the two terminal states. */
export function isContentActive(item: Pick<ContentItem, 'status'>): boolean {
  return item.status !== 'published' && item.status !== 'cancelled';
}

/** Overdue only when a planned date exists, is in the past (date-only
 * comparison — plannedPublishDate is a date, not a timestamp), and the piece
 * hasn't reached a terminal state. Never persisted. */
export function isContentOverdue(item: Pick<ContentItem, 'plannedPublishDate' | 'status'>): boolean {
  if (!item.plannedPublishDate) return false;
  if (!isContentActive(item)) return false;
  return item.plannedPublishDate < todayDateOnly();
}

export type ContentItemsSummary = {
  total: number;
  active: number;
  idea: number;
  scripting: number;
  recording: number;
  editing: number;
  ready: number;
  published: number;
  cancelled: number;
  overdue: number;
};

/** KPI totals over whatever set is passed in — callers recompute from the
 * currently filtered list, same convention as summarizeAutomations/
 * summarizeCampaigns. */
export function summarizeContentItems(items: ContentItem[]): ContentItemsSummary {
  return {
    total: items.length,
    active: items.filter(isContentActive).length,
    idea: items.filter((item) => item.status === 'idea').length,
    scripting: items.filter((item) => item.status === 'scripting').length,
    recording: items.filter((item) => item.status === 'recording').length,
    editing: items.filter((item) => item.status === 'editing').length,
    ready: items.filter((item) => item.status === 'ready').length,
    published: items.filter((item) => item.status === 'published').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
    overdue: items.filter(isContentOverdue).length,
  };
}

// ===== LABELS =====

/** Legacy display helper — no active operational caller (Content Truth V1
 * audit confirmed this). ClientContentPanel already knows the client's real
 * (PostgreSQL) name from its parent page and never calls this; ContentBoard
 * is internal-only and never resolves a client name at all. Left in place,
 * still backed by the obsolete lib/clients.ts mirror, only because nothing
 * live depends on it — do not wire this into new UI without first pointing
 * it at lib/api/clients.ts instead. */
export function getClientNameForContentItem(clientId: string | null): string {
  if (!clientId) return 'Interno · REKREATIVE';
  const client = getClients().find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getContentScopeLabel(scope: ContentScope): string {
  return CONTENT_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

export function getContentFormatLabel(format: ContentFormat): string {
  return CONTENT_FORMAT_OPTIONS.find((option) => option.id === format)?.label ?? format;
}

export function getContentPlatformLabel(platform: ContentPlatform): string {
  return CONTENT_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

export function getContentStatusLabel(status: ContentStatus): string {
  return CONTENT_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}
