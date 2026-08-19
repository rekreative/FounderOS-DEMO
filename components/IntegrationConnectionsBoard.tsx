'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getClients, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import {
  INTEGRATION_CONFIGURATION_STATUS_OPTIONS,
  INTEGRATION_PLATFORM_OPTIONS,
  INTEGRATION_VERIFICATION_STATUS_OPTIONS,
  createIntegrationConnection,
  getClientNameForIntegrationConnection,
  getIntegrationConfigurationStatus,
  getIntegrationConfigurationStatusLabel,
  getIntegrationPlatformLabel,
  getIntegrationConnections,
  getIntegrationVerificationStatusLabel,
  initializeIntegrationConnectionsStoreIfNeeded,
  markIntegrationConnectionFailed,
  markIntegrationConnectionVerified,
  resetIntegrationConnectionVerification,
  summarizeIntegrationConnections,
  updateIntegrationConnection,
  type IntegrationConnection,
  type IntegrationConfigurationStatus,
  type IntegrationPlatform,
  type IntegrationScope,
  type IntegrationVerificationStatus,
} from '@/lib/integration-connections';
import {
  buildClientRequirementRows,
  getClientIntegrationRequirements,
  getIntegrationRequirementLevelLabel,
  getRequirementConnectionScopeLabel,
  getRequirementStateLabel,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  setClientIntegrationRequirement,
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
  type ClientOnboardingSummary,
  type ClientRequirementRow,
  type IntegrationRequirementLevel,
  type RequirementConnectionState,
} from '@/lib/client-integration-requirements';
import { Badge, SectionHead, type BadgeTone } from '@/components/terminal';

const CONFIGURATION_FILTERS = [{ id: 'all', label: 'Todas' }, ...INTEGRATION_CONFIGURATION_STATUS_OPTIONS];
const VERIFICATION_FILTERS = [{ id: 'all', label: 'Todas' }, ...INTEGRATION_VERIFICATION_STATUS_OPTIONS];
const PLATFORM_FILTERS = [{ id: 'all', label: 'Todas las plataformas' }, ...INTEGRATION_PLATFORM_OPTIONS];

// ── Platform catalog (presentation only — no model/storage impact) ─────────
// "Principales" = the small set of high-value platforms REKREATIVE actually
// uses day to day. "Explorar por categoría" groups the full controlled
// IntegrationPlatform enum (lib/integration-connections.ts) into
// REKREATIVE-relevant buckets — deliberately NOT FounderOS's generic
// marketplace categories, and never a platform outside that enum.
// Stripe joins Principales ahead of ManyChat: financial-connection visibility
// (future revenue ingestion) now matters more strategically than it did when
// this list was first drafted. ManyChat stays fully available below, in
// Mensajería.
const PRINCIPAL_PLATFORMS: IntegrationPlatform[] = ['meta', 'whatsapp', 'make', 'openai', 'google_sheets', 'stripe'];

const CATALOG_CATEGORIES: { label: string; platforms: IntegrationPlatform[] }[] = [
  { label: 'Captación', platforms: ['meta', 'instagram'] },
  { label: 'Mensajería', platforms: ['whatsapp', 'manychat'] },
  { label: 'Automatización e IA', platforms: ['make', 'openai', 'anthropic'] },
  { label: 'Datos', platforms: ['google_sheets', 'google_calendar'] },
  { label: 'Finanzas', platforms: ['stripe', 'paypal'] },
  { label: 'Otras', platforms: ['other'] },
];

/** Platforms a client's onboarding plan can toggle — every controlled
 * platform except 'other', which is a catch-all, not a meaningful per-client
 * requirement. */
const REQUIREMENT_EDITABLE_PLATFORMS: IntegrationPlatform[] = INTEGRATION_PLATFORM_OPTIONS.map((o) => o.id).filter(
  (id) => id !== 'other',
);

const PLATFORM_DESCRIPTIONS: Record<IntegrationPlatform, string> = {
  meta: 'Publicidad y captación',
  instagram: 'Contenido y comunidad',
  whatsapp: 'Mensajería y seguimiento',
  make: 'Automatización de flujos',
  manychat: 'Mensajería y automatización',
  openai: 'IA y procesamiento',
  anthropic: 'IA y procesamiento',
  google_sheets: 'Datos y reporting',
  google_calendar: 'Citas y calendario',
  stripe: 'Pagos, facturas y suscripciones',
  paypal: 'Pagos y cobros',
  other: 'Otras plataformas',
};

type DraftConnection = {
  scope: IntegrationScope;
  clientId: string;
  platform: IntegrationPlatform;
  name: string;
  externalRef: string;
  externalLabel: string;
  notes: string;
};

const emptyDraft = (clientId = '', platform: IntegrationPlatform = 'meta'): DraftConnection => ({
  scope: 'client',
  clientId,
  platform,
  name: '',
  externalRef: '',
  externalLabel: '',
  notes: '',
});

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const CONFIGURATION_TONE: Record<IntegrationConfigurationStatus, BadgeTone> = {
  configured: 'ok',
  incomplete: 'warn',
};

const VERIFICATION_TONE: Record<IntegrationVerificationStatus, BadgeTone> = {
  not_verified: 'default',
  verified: 'ok',
  failed: 'err',
};

function ConfigurationStatusBadge({ connection }: { connection: IntegrationConnection }) {
  const status = getIntegrationConfigurationStatus(connection);
  return <Badge tone={CONFIGURATION_TONE[status]}>{getIntegrationConfigurationStatusLabel(status)}</Badge>;
}

function VerificationStatusBadge({ connection }: { connection: IntegrationConnection }) {
  return (
    <Badge tone={VERIFICATION_TONE[connection.verificationStatus]}>
      {getIntegrationVerificationStatusLabel(connection)}
    </Badge>
  );
}

function DataSourceTag({ dataSource }: { dataSource: IntegrationConnection['dataSource'] }) {
  const tone = dataSource === 'manual' ? 'text-os-muted' : 'text-os-dim';
  const label = dataSource === 'manual' ? 'Manual' : 'Demo';
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${value}%`;
}

/** One row in "Onboarding técnico por cliente" — client identity is the
 * organizing concept here, not the platform. progressPercent/counts come
 * from summarizeClientOnboarding (required-only, never reduced by optional
 * platforms). */
function OnboardingClientCard({
  client,
  summary,
  onManage,
}: {
  client: Client;
  summary: ClientOnboardingSummary;
  onManage: () => void;
}) {
  const notConfigured = summary.requiredPending + summary.requiredIncomplete;
  return (
    <div className="flex flex-col justify-between border border-os-border bg-os-surface p-4">
      <div>
        <div className="truncate text-[13px] font-semibold leading-tight text-os-text">{client.name}</div>
        <div className="mt-1.5 font-mono text-[10.5px] text-os-muted">
          {summary.requiredTotal === 0
            ? 'Sin integraciones requeridas definidas'
            : `${summary.requiredConfigured} / ${summary.requiredTotal} integraciones requeridas configuradas`}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-mono text-[20px] font-semibold text-os-text">{formatPercent(summary.progressPercent)}</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">onboarding técnico</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
          {notConfigured} {notConfigured === 1 ? 'pendiente' : 'pendientes'}
        </span>
        <span className="text-os-dim">·</span>
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
          {summary.incidents} {summary.incidents === 1 ? 'incidencia' : 'incidencias'}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-end border-t border-os-border pt-2.5">
        <button
          type="button"
          onClick={onManage}
          className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
        >
          Gestionar
        </button>
      </div>
    </div>
  );
}

const REQUIREMENT_STATE_TONE: Record<RequirementConnectionState, BadgeTone> = {
  pending: 'default',
  incomplete: 'warn',
  configured: 'ok',
};

/** One requirement row in the selected client's onboarding workspace.
 * Deliberately shows configuration state and verification state as two
 * separate lines — same honesty split as everywhere else in this module,
 * never CONNECTED/NOT CONNECTED. */
function RequirementRowCard({
  row,
  logo,
  onAdd,
  onManage,
}: {
  row: ClientRequirementRow;
  logo: ReactNode;
  onAdd: () => void;
  onManage: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-os-border bg-os-surface px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {logo}
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold leading-tight text-os-text">{getIntegrationPlatformLabel(row.platform)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={row.requirement === 'required' ? 'accent' : 'default'}>{getIntegrationRequirementLevelLabel(row.requirement)}</Badge>
            {row.connectionScope === 'internal' && <Badge tone="default">{getRequirementConnectionScopeLabel('internal')}</Badge>}
            <Badge tone={REQUIREMENT_STATE_TONE[row.state]}>{getRequirementStateLabel(row.state, row.requirement)}</Badge>
          </div>
          {row.connection && (
            <div className="mt-1 font-mono text-[9.5px] text-os-dim">{getIntegrationVerificationStatusLabel(row.connection)}</div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={row.connection ? onManage : onAdd}
        className="shrink-0 border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
      >
        {row.connection ? 'Gestionar' : 'Añadir conexión'}
      </button>
    </div>
  );
}

/** One platform tile in the catalog (both "Principales" and "Explorar por
 * categoría" reuse this same card). Deliberately never says
 * connected/disconnected/connect — only how many IntegrationConnection
 * records exist for this platform, and whether any of them are incomplete
 * or have a manually-recorded incident. Counts come from ALL connections
 * (every client + internal) — the catalog is global discovery, secondary to
 * the client-first onboarding sections above it, so it stays a stable
 * overview unaffected by any single filter. */
function PlatformCatalogCard({
  platform,
  logo,
  count,
  hasIncomplete,
  hasIncident,
  onAdd,
  onManage,
}: {
  platform: IntegrationPlatform;
  logo: ReactNode;
  count: number;
  hasIncomplete: boolean;
  hasIncident: boolean;
  onAdd: () => void;
  onManage: () => void;
}) {
  return (
    <div className="flex flex-col justify-between border border-os-border bg-os-surface p-4">
      <div className="flex items-start gap-3">
        {logo}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold leading-tight text-os-text">{getIntegrationPlatformLabel(platform)}</div>
          <div className="mt-1 truncate text-[10.5px] leading-tight text-os-dim">{PLATFORM_DESCRIPTIONS[platform]}</div>
        </div>
      </div>

      {(hasIncomplete || hasIncident) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hasIncomplete && <Badge tone="warn">Incompleta</Badge>}
          {hasIncident && <Badge tone="err">Incidencia</Badge>}
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-os-border pt-3">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
          {count === 0 ? 'Sin conexiones' : `${count} ${count === 1 ? 'conexión' : 'conexiones'}`}
        </span>
        <div className="flex items-center gap-1.5">
          {count > 0 && (
            <button
              type="button"
              onClick={onManage}
              className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
            >
              Gestionar
            </button>
          )}
          <button
            type="button"
            onClick={onAdd}
            className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent"
          >
            + Añadir
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compact collapsible category block for "Explorar por categoría" — same
 * disclosure idea as FounderOS's marketplace category rows, rebuilt locally
 * with REKREATIVE's square-cornered card language rather than importing
 * FounderOS's component. */
function CategorySection({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-os-border bg-os-surface">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
        <span className={`shrink-0 font-mono text-os-dim transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
        <span className="flex-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-os-text">{label}</span>
        <span className="font-mono text-[10px] text-os-dim">{count}</span>
      </button>
      {open && <div className="grid grid-cols-1 gap-2.5 border-t border-os-border p-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>}
    </div>
  );
}

function ConnectionCard({
  connection,
  clientName,
  platformLogosLarge,
  expanded,
  onToggle,
  onEdit,
  onMarkVerified,
  onMarkFailed,
  onReset,
}: {
  connection: IntegrationConnection;
  clientName: string;
  platformLogosLarge: Record<string, ReactNode>;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMarkVerified: () => void;
  onMarkFailed: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col border border-os-border bg-os-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {platformLogosLarge[connection.platform]}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold leading-tight text-os-text">{connection.name || 'Sin nombre'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-os-muted">
              <span className="truncate">{clientName}</span>
              <span className="text-os-dim">·</span>
              <span className="truncate text-os-dim">{getIntegrationPlatformLabel(connection.platform)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ConfigurationStatusBadge connection={connection} />
          <VerificationStatusBadge connection={connection} />
        </div>
      </div>

      {(connection.externalLabel || connection.externalRef) && (
        <div className="mt-2.5 font-mono text-[10.5px] text-os-muted">
          {connection.externalLabel}
          {connection.externalLabel && connection.externalRef && <span className="text-os-dim"> · </span>}
          {connection.externalRef}
        </div>
      )}

      <div className="mt-2.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
        Última verificación: <span className="text-os-muted">{formatDateTime(connection.lastVerifiedAt)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-os-border pt-2.5">
        <DataSourceTag dataSource={connection.dataSource} />
        <div className="flex flex-wrap items-center gap-3">
          {connection.verificationStatus === 'not_verified' ? (
            <>
              <button type="button" onClick={onMarkVerified} className="font-mono text-[9px] uppercase tracking-wide text-os-ok hover:opacity-80">
                marcar verificada
              </button>
              <button type="button" onClick={onMarkFailed} className="font-mono text-[9px] uppercase tracking-wide text-os-err hover:opacity-80">
                marcar incidencia
              </button>
            </>
          ) : (
            <button type="button" onClick={onReset} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
              restablecer a no verificada
            </button>
          )}
          <button type="button" onClick={onEdit} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
            editar
          </button>
          <button type="button" onClick={onToggle} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-accent">
            {expanded ? '− ocultar detalle' : '+ detalle'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-os-border pt-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Ámbito</div>
            <p className="text-[11px] text-os-muted">
              {connection.scope === 'internal' ? 'Interno · REKREATIVE' : `Cliente · ${clientName}`}
            </p>

            <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Referencia externa</div>
            <p className="text-[11px] text-os-muted">{connection.externalLabel || '—'}</p>
            <p className="mt-0.5 font-mono text-[10.5px] text-os-dim">{connection.externalRef || '—'}</p>

            {connection.notes && (
              <>
                <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Notas</div>
                <p className="text-[11px] text-os-muted">{connection.notes}</p>
              </>
            )}
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Verificación</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[9.5px] text-os-dim">
              <div>
                <div className="uppercase tracking-wide">Estado</div>
                <div className="mt-0.5 text-os-muted">{getIntegrationVerificationStatusLabel(connection)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Método</div>
                <div className="mt-0.5 text-os-muted">{connection.verificationMethod === 'manual' ? 'Manual' : connection.verificationMethod === 'system' ? 'Sistema' : '—'}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Última verificación</div>
                <div className="mt-0.5 text-os-muted">{formatDateTime(connection.lastVerifiedAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Configuración</div>
                <div className="mt-0.5 text-os-muted">{getIntegrationConfigurationStatusLabel(getIntegrationConfigurationStatus(connection))}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Creado</div>
                <div className="mt-0.5 text-os-muted">{formatDate(connection.createdAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Actualizado</div>
                <div className="mt-0.5 text-os-muted">{formatDate(connection.updatedAt)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntegrationConnectionsBoard({
  platformLogosLarge,
}: {
  platformLogosLarge: Record<string, ReactNode>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  // Unfiltered by clientFilter — the onboarding overview, selected-client
  // workspace, internal-connections section, and platform catalog all need
  // every connection regardless of the operational board's own Cliente/
  // Ámbito filter below. `connections` (above) stays exactly as before,
  // scoped to that filter, for the existing "Conexiones actuales" board.
  const [allConnections, setAllConnections] = useState<IntegrationConnection[]>([]);
  const [requirements, setRequirements] = useState<ClientIntegrationRequirement[]>([]);
  const [selectedOnboardingClientId, setSelectedOnboardingClientId] = useState<string | null>(null);
  const [showRequirementsEditor, setShowRequirementsEditor] = useState(false);
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | IntegrationPlatform>('all');
  const [configurationFilter, setConfigurationFilter] = useState<'all' | IntegrationConfigurationStatus>('all');
  const [verificationFilter, setVerificationFilter] = useState<'all' | IntegrationVerificationStatus>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftConnection>(emptyDraft());
  const connectionsSectionRef = useRef<HTMLDivElement>(null);
  const onboardingWorkspaceRef = useRef<HTMLDivElement>(null);

  const activeClientId = () => (clientFilter === 'all' ? undefined : clientFilter);

  const refresh = () => {
    setConnections(getIntegrationConnections(activeClientId()));
    setAllConnections(getIntegrationConnections());
  };

  const refreshRequirements = () => setRequirements(getClientIntegrationRequirements());

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();
    const loadedClients = getClients();
    setClients(loadedClients);
    setConnections(getIntegrationConnections());
    setAllConnections(getIntegrationConnections());
    setRequirements(getClientIntegrationRequirements());
    setSelectedOnboardingClientId((current) => current ?? loadedClients[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  // ── Onboarding derivations (requirements bridged to connections) ────────
  const requirementsByClient = useMemo(() => {
    const map: Record<string, ClientIntegrationRequirement[]> = {};
    for (const row of requirements) (map[row.clientId] ??= []).push(row);
    return map;
  }, [requirements]);

  const connectionsByClient = useMemo(() => {
    const map: Record<string, IntegrationConnection[]> = {};
    for (const c of allConnections) if (c.clientId) (map[c.clientId] ??= []).push(c);
    return map;
  }, [allConnections]);

  const internalConnections = useMemo(() => allConnections.filter((c) => c.scope === 'internal'), [allConnections]);

  // A requirement with connectionScope==='internal' (Make, OpenAI, ...) is
  // satisfied by REKREATIVE's own shared connection, not a client-owned
  // duplicate — so every client's match pool is their own connections PLUS
  // every internal connection. buildClientRequirementRows picks the right
  // one per row based on each requirement's own connectionScope.
  const matchPoolForClient = (clientId: string) => [...(connectionsByClient[clientId] ?? []), ...internalConnections];

  const onboardingSummaries = useMemo(() => {
    const map: Record<string, ClientOnboardingSummary> = {};
    for (const client of clients) {
      map[client.id] = summarizeClientOnboarding(client.id, requirementsByClient[client.id] ?? [], matchPoolForClient(client.id));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, requirementsByClient, connectionsByClient, internalConnections]);

  const selectedClient = clients.find((c) => c.id === selectedOnboardingClientId) ?? null;
  const selectedClientRows = useMemo(
    () =>
      selectedOnboardingClientId
        ? buildClientRequirementRows(requirementsByClient[selectedOnboardingClientId] ?? [], matchPoolForClient(selectedOnboardingClientId))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedOnboardingClientId, requirementsByClient, connectionsByClient, internalConnections],
  );

  // Catalog stats read from `allConnections` (every client + internal) — the
  // catalog is global discovery, not scoped to any one filter.
  const platformStats = useMemo(() => {
    const stats: Partial<Record<IntegrationPlatform, { count: number; hasIncomplete: boolean; hasIncident: boolean }>> = {};
    for (const c of allConnections) {
      const entry = stats[c.platform] ?? { count: 0, hasIncomplete: false, hasIncident: false };
      entry.count += 1;
      if (getIntegrationConfigurationStatus(c) === 'incomplete') entry.hasIncomplete = true;
      if (c.verificationStatus === 'failed') entry.hasIncident = true;
      stats[c.platform] = entry;
    }
    return stats;
  }, [allConnections]);

  const statsFor = (platform: IntegrationPlatform) => platformStats[platform] ?? { count: 0, hasIncomplete: false, hasIncident: false };

  const focusOnboardingClient = (clientId: string) => {
    setSelectedOnboardingClientId(clientId);
    onboardingWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const focusOperationalConnection = (clientId: string, platform: IntegrationPlatform) => {
    setClientFilter(clientId);
    setPlatformFilter(platform);
    connectionsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSetRequirement = (clientId: string, platform: IntegrationPlatform, level: IntegrationRequirementLevel | null) => {
    setClientIntegrationRequirement(clientId, platform, level);
    refreshRequirements();
  };

  const visibleConnections = useMemo(
    () =>
      connections.filter((connection) => {
        // Internal (scope==='internal') connections are managed exclusively
        // through "Integraciones internas REKREATIVE" above — never shown
        // here too. Display/filtering only; nothing is removed from storage.
        if (connection.scope === 'internal') return false;
        if (platformFilter !== 'all' && connection.platform !== platformFilter) return false;
        if (configurationFilter !== 'all' && getIntegrationConfigurationStatus(connection) !== configurationFilter) return false;
        if (verificationFilter !== 'all' && connection.verificationStatus !== verificationFilter) return false;
        return true;
      }),
    [connections, clientFilter, platformFilter, configurationFilter, verificationFilter],
  );

  const summary = useMemo(() => summarizeIntegrationConnections(visibleConnections), [visibleConnections]);

  /** preselectScope defaults to 'client'. An 'internal' requirement row with
   * no connection yet must open the form as an internal (shared) connection,
   * not a client-owned duplicate — the whole point of connectionScope. */
  const openCreateForm = (preselectPlatform?: IntegrationPlatform, preselectClientId?: string, preselectScope: IntegrationScope = 'client') => {
    if (preselectScope === 'internal') {
      setDraft({ scope: 'internal', clientId: '', platform: preselectPlatform ?? 'meta', name: '', externalRef: '', externalLabel: '', notes: '' });
    } else {
      const firstClient = preselectClientId ?? clients[0]?.id ?? '';
      setDraft(emptyDraft(firstClient, preselectPlatform ?? 'meta'));
    }
    setEditingConnectionId(null);
    setShowForm(true);
  };

  /** "Gestionar" on a catalog card — focuses the existing connections
   * section on that platform via the existing platform filter, no new
   * route, no duplicated list. */
  const focusPlatform = (platform: IntegrationPlatform) => {
    setPlatformFilter(platform);
    connectionsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openEditForm = (connection: IntegrationConnection) => {
    setEditingConnectionId(connection.id);
    setDraft({
      scope: connection.scope,
      clientId: connection.clientId ?? '',
      platform: connection.platform,
      name: connection.name,
      externalRef: connection.externalRef ?? '',
      externalLabel: connection.externalLabel ?? '',
      notes: connection.notes ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingConnectionId(null);
    setDraft(emptyDraft(clients[0]?.id ?? ''));
  };

  const submitConnection = () => {
    const name = draft.name.trim();
    if (!name) return;
    if (draft.scope === 'client' && !draft.clientId) return;

    const payload = {
      scope: draft.scope,
      clientId: draft.scope === 'client' ? draft.clientId : null,
      platform: draft.platform,
      name,
      externalRef: draft.externalRef.trim() || null,
      externalLabel: draft.externalLabel.trim() || null,
      notes: draft.notes.trim() || null,
    };

    if (editingConnectionId) {
      updateIntegrationConnection(editingConnectionId, payload);
    } else {
      createIntegrationConnection({ ...payload, dataSource: 'manual' });
    }

    refresh();
    closeForm();
  };

  const handleMarkVerified = (id: string) => {
    markIntegrationConnectionVerified(id);
    refresh();
  };
  const handleMarkFailed = (id: string) => {
    markIntegrationConnectionFailed(id);
    refresh();
  };
  const handleReset = (id: string) => {
    resetIntegrationConnectionVerification(id);
    refresh();
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE OPERACIONES</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Integraciones</h1>
          <p className="mt-1.5 max-w-xl text-[12px] text-os-muted">
            Gestiona las plataformas y conexiones utilizadas por REKREATIVE y sus clientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateForm()}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            + Añadir conexión
          </button>
        </div>
      </div>

      {/* KPI summary — always recomputed from the currently filtered set */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Configuradas', value: String(summary.configured) },
          { label: 'Incompletas', value: String(summary.incomplete) },
          { label: 'No verificadas', value: String(summary.notVerified) },
          { label: 'Incidencias', value: String(summary.incidents) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[18px] font-semibold text-os-text">{tile.value}</div>
          </div>
        ))}
      </div>

      {/* Onboarding técnico por cliente — client is the primary organizing
          concept for REKREATIVE (agency, multi-client), not platform. One
          compact row per client; progress is REQUIRED-only, never reduced by
          optional platforms (see summarizeClientOnboarding). */}
      <div className="mb-4">
        <SectionHead label="Onboarding técnico por cliente" count={clients.length} />
        {clients.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            No hay clientes todavía.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
              <OnboardingClientCard
                key={client.id}
                client={client}
                summary={onboardingSummaries[client.id] ?? summarizeClientOnboarding(client.id, [], [])}
                onManage={() => focusOnboardingClient(client.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cliente seleccionado — the onboarding workspace for one client at a
          time, requirement rows grouped by the same categories the catalog
          uses below. This is where "required vs optional" and "pending vs
          configuración incompleta vs configurada" become visible per
          platform — never CONNECTED/NOT CONNECTED. */}
      <div ref={onboardingWorkspaceRef} className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionHead label="Cliente seleccionado" />
          {selectedClient && (
            <button
              type="button"
              onClick={() => setShowRequirementsEditor(true)}
              className="border border-os-border px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent"
            >
              Gestionar requisitos
            </button>
          )}
        </div>

        {!selectedClient ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            Selecciona un cliente arriba para ver sus integraciones.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <select
                value={selectedClient.id}
                onChange={(event) => setSelectedOnboardingClientId(event.target.value)}
                className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">— Integraciones</span>
            </div>

            {selectedClientRows.length === 0 ? (
              <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Este cliente no tiene integraciones definidas. Usa &quot;Gestionar requisitos&quot; para añadir alguna.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {CATALOG_CATEGORIES.map((category) => {
                  const rows = selectedClientRows.filter((row) => category.platforms.includes(row.platform));
                  if (rows.length === 0) return null;
                  return (
                    <div key={category.label}>
                      <div className="mb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-os-dim">{category.label}</div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {rows.map((row) => (
                          <RequirementRowCard
                            key={row.platform}
                            row={row}
                            logo={platformLogosLarge[row.platform]}
                            onAdd={() => openCreateForm(row.platform, selectedClient.id, row.connectionScope)}
                            onManage={() => focusOperationalConnection(selectedClient.id, row.platform)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Integraciones internas REKREATIVE — shared agency infrastructure
          (scope === 'internal'), kept visually distinct from client-owned
          connections. Reuses the exact same ConnectionCard as "Conexiones
          actuales" below — same edit/verify/fail/reset behavior, no
          duplicated logic. */}
      <div className="mb-4">
        <SectionHead label="Integraciones internas REKREATIVE" count={internalConnections.length} />
        {internalConnections.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            No hay integraciones internas todavía.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {internalConnections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                clientName="Interno"
                platformLogosLarge={platformLogosLarge}
                expanded={Boolean(expanded[connection.id])}
                onToggle={() => setExpanded((prev) => ({ ...prev, [connection.id]: !prev[connection.id] }))}
                onEdit={() => openEditForm(connection)}
                onMarkVerified={() => handleMarkVerified(connection.id)}
                onMarkFailed={() => handleMarkFailed(connection.id)}
                onReset={() => handleReset(connection.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Conexiones actuales — the actual operational records. Same filters,
          same cards, same behavior already validated; only the section
          framing and an optional platform focus chip are new. Sits right
          after Principales (day-to-day workspace, not pushed below the
          fold) — the full category browser sits below it since it's
          discovery, not daily operation. */}
      <div ref={connectionsSectionRef}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <SectionHead label="Conexiones actuales" count={visibleConnections.length} />
          </div>
          {platformFilter !== 'all' && (
            <div className="flex items-center gap-2">
              <Badge tone="accent">{getIntegrationPlatformLabel(platformFilter)}</Badge>
              <button
                type="button"
                onClick={() => setPlatformFilter('all')}
                className="font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:text-os-accent"
              >
                Todas las plataformas
              </button>
            </div>
          )}
        </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {CONFIGURATION_FILTERS.map((option) => {
            const active = configurationFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setConfigurationFilter(option.id as 'all' | IntegrationConfigurationStatus)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Verificación</label>
          <select
            value={verificationFilter}
            onChange={(event) => setVerificationFilter(event.target.value as 'all' | IntegrationVerificationStatus)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            {VERIFICATION_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Plataforma</label>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as 'all' | IntegrationPlatform)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            {PLATFORM_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
          <select
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            <option value="all">Todos los clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Connection cards */}
      {visibleConnections.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay integraciones en este segmento.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleConnections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              clientName={getClientNameForIntegrationConnection(connection.clientId)}
              platformLogosLarge={platformLogosLarge}
              expanded={Boolean(expanded[connection.id])}
              onToggle={() => setExpanded((prev) => ({ ...prev, [connection.id]: !prev[connection.id] }))}
              onEdit={() => openEditForm(connection)}
              onMarkVerified={() => handleMarkVerified(connection.id)}
              onMarkFailed={() => handleMarkFailed(connection.id)}
              onReset={() => handleReset(connection.id)}
            />
          ))}
        </div>
      )}
      </div>

      {/* Principales / Explorar integraciones — the platform catalog is now
          SECONDARY: onboarding-by-client and the operational board above are
          the day-to-day workspace; this stays available for discovery
          without dominating the page. Never claims connected/disconnected —
          only how many IntegrationConnection records exist per platform. */}
      <div className="mb-4 mt-2">
        <SectionHead label="Principales" count={PRINCIPAL_PLATFORMS.length} />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPAL_PLATFORMS.map((platform) => {
            const stats = statsFor(platform);
            return (
              <PlatformCatalogCard
                key={platform}
                platform={platform}
                logo={platformLogosLarge[platform]}
                count={stats.count}
                hasIncomplete={stats.hasIncomplete}
                hasIncident={stats.hasIncident}
                onAdd={() => openCreateForm(platform)}
                onManage={() => focusPlatform(platform)}
              />
            );
          })}
        </div>
      </div>

      {/* Explorar por categoría — the full controlled platform enum, grouped
          into REKREATIVE-relevant buckets, not FounderOS's generic
          marketplace. Discovery, so it sits below the operational board. */}
      <div className="mb-4 mt-4">
        <SectionHead label="Explorar por categoría" />
        <div className="flex flex-col gap-2">
          {CATALOG_CATEGORIES.map((category) => (
            <CategorySection key={category.label} label={category.label} count={category.platforms.length}>
              {category.platforms.map((platform) => {
                const stats = statsFor(platform);
                return (
                  <PlatformCatalogCard
                    key={platform}
                    platform={platform}
                    logo={platformLogosLarge[platform]}
                    count={stats.count}
                    hasIncomplete={stats.hasIncomplete}
                    hasIncident={stats.hasIncident}
                    onAdd={() => openCreateForm(platform)}
                    onManage={() => focusPlatform(platform)}
                  />
                );
              })}
            </CategorySection>
          ))}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingConnectionId ? 'Editar conexión' : 'Nueva conexión'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Ámbito</span>
                <div className="flex gap-1.5">
                  {(['client', 'internal'] as IntegrationScope[]).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, scope, clientId: scope === 'internal' ? '' : prev.clientId }))}
                      className={`border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide ${
                        draft.scope === scope ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim'
                      }`}
                    >
                      {scope === 'client' ? 'Cliente' : 'Interno'}
                    </button>
                  ))}
                </div>
              </div>

              {draft.scope === 'client' && (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <select
                    value={draft.clientId}
                    onChange={(event) => setDraft((prev) => ({ ...prev, clientId: event.target.value }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                  >
                    <option value="">Selecciona un cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Plataforma</span>
                <select
                  value={draft.platform}
                  onChange={(event) => setDraft((prev) => ({ ...prev, platform: event.target.value as IntegrationPlatform }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {INTEGRATION_PLATFORM_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="p. ej. WhatsApp Business — Acme"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Referencia externa</span>
                <input
                  value={draft.externalRef}
                  onChange={(event) => setDraft((prev) => ({ ...prev, externalRef: event.target.value }))}
                  placeholder="ID de cuenta/workspace (opcional)"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Etiqueta externa</span>
                <input
                  value={draft.externalLabel}
                  onChange={(event) => setDraft((prev) => ({ ...prev, externalLabel: event.target.value }))}
                  placeholder="Nombre reconocible de la cuenta (opcional)"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Notas</span>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Contexto adicional (opcional)"
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <p className="mt-3 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
              El estado de verificación se gestiona desde la tarjeta, no desde este formulario.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitConnection} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingConnectionId ? 'Guardar conexión' : 'Crear conexión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequirementsEditor && selectedClient && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">Requisitos — {selectedClient.name}</h2>
              <button
                type="button"
                onClick={() => setShowRequirementsEditor(false)}
                className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent"
              >
                cerrar
              </button>
            </div>
            <p className="mb-3 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
              No todos los clientes necesitan todas las plataformas.
            </p>

            <div className="flex flex-col">
              {REQUIREMENT_EDITABLE_PLATFORMS.map((platform) => {
                const current = (requirementsByClient[selectedClient.id] ?? []).find((r) => r.platform === platform)?.requirement ?? null;
                return (
                  <div key={platform} className="flex items-center justify-between gap-2 border-b border-os-border py-2 last:border-b-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {platformLogosLarge[platform]}
                      <span className="truncate text-[12px] text-os-text">{getIntegrationPlatformLabel(platform)}</span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {([
                        ['required', 'Requerida'],
                        ['optional', 'Opcional'],
                        [null, 'No usada'],
                      ] as const).map(([level, label]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => handleSetRequirement(selectedClient.id, platform, level)}
                          className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-wide ${
                            current === level
                              ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                              : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowRequirementsEditor(false)}
                className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
