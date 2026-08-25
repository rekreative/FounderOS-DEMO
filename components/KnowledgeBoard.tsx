'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import {
  KNOWLEDGE_SOURCE_OPTIONS,
  KNOWLEDGE_TYPE_OPTIONS,
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  getClientNameForKnowledgeEntry,
  getKnowledgeEntries,
  getKnowledgeSourceLabel,
  getKnowledgeTypeLabel,
  initializeKnowledgeStoreIfNeeded,
  restoreKnowledgeEntry,
  searchKnowledgeEntries,
  summarizeKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeEntry,
  type KnowledgeScope,
  type KnowledgeSource,
  type KnowledgeType,
} from '@/lib/knowledge-entries';

// G-Brain V1 — REKREATIVE's structured institutional memory. Global board:
// every KnowledgeEntry, internal AND client, one store
// (lib/knowledge-entries.ts). Client-scoped browsing/CRUD from inside a
// client workspace goes through components/ClientKnowledgePanel.tsx instead
// — same store, filtered by clientId, scope/client locked. This board is
// intentionally plain: search + filters + a list + a detail/edit panel, no
// graph, no fake AI. "Feels like a brain because it's structured and
// retrievable" — see CLAUDE.md.

type StatusView = 'active' | 'archived';
type ScopeFilter = 'all' | 'internal' | 'client';

type DraftKnowledgeEntry = {
  scope: KnowledgeScope;
  clientId: string;
  title: string;
  type: KnowledgeType;
  tags: string;
  summary: string;
  content: string;
  source: KnowledgeSource;
  sourceLabel: string;
};

const emptyDraft = (): DraftKnowledgeEntry => ({
  scope: 'internal',
  clientId: '',
  title: '',
  type: 'decision',
  tags: '',
  summary: '',
  content: '',
  source: 'manual',
  sourceLabel: '',
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TYPE_TONE_CLASS: Record<KnowledgeType, string> = {
  decision: 'text-os-accent',
  learning: 'text-os-ok',
  sop: 'text-os-muted',
  strategy: 'text-os-warn',
  client_context: 'text-os-muted',
  technical_note: 'text-os-dim',
  other: 'text-os-dim',
};

function KnowledgeCard({
  entry,
  clients,
  onOpen,
  onTagClick,
}: {
  entry: KnowledgeEntry;
  clients: { id: string; name: string }[];
  onOpen: () => void;
  onTagClick: (tag: string) => void;
}) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col gap-3 border border-os-border bg-os-surface p-4 transition-colors hover:border-os-border-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold leading-snug text-os-text">{entry.title}</div>
          {entry.summary && (
            <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-os-muted">{entry.summary}</p>
          )}
        </div>
        <span
          className={`shrink-0 border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${TYPE_TONE_CLASS[entry.type]}`}
        >
          {getKnowledgeTypeLabel(entry.type)}
        </span>
      </div>

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTagClick(tag);
              }}
              className="border border-os-border px-1.5 py-0.5 font-mono text-[9px] text-os-dim hover:border-os-border-strong hover:text-os-accent"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-os-border pt-2.5 font-mono text-[9.5px]">
        <span className="truncate text-os-dim">
          {getClientNameForKnowledgeEntry(entry.clientId, clients)} · {getKnowledgeSourceLabel(entry.source)}
        </span>
        <span className="shrink-0 text-os-muted">{formatDate(entry.updatedAt)}</span>
      </div>

      <div className="flex items-center justify-between font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
        <span>{entry.dataSource === 'manual' ? 'manual' : 'demo'}</span>
        {entry.status === 'archived' && <span className="text-os-warn">archivado</span>}
      </div>
    </div>
  );
}

export function KnowledgeBoard() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  // Canonical PostgreSQL Client registry — Knowledge entries themselves stay
  // localStorage; only client identity/selection moved.
  const { clients } = useClientsRegistry();

  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | KnowledgeType>('all');
  const [statusView, setStatusView] = useState<StatusView>('active');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [panelMode, setPanelMode] = useState<'closed' | 'view' | 'edit' | 'create'>('closed');
  const [activeEntry, setActiveEntry] = useState<KnowledgeEntry | null>(null);
  const [draft, setDraft] = useState<DraftKnowledgeEntry>(emptyDraft());
  const [saveError, setSaveError] = useState<string | null>(null);

  // G-Brain Truth V1: operational default is manual-only, same convention as
  // Content (components/ContentBoard.tsx) — seed/demo rows stay in the store
  // (never deleted) but are excluded from every list and KPI below unless
  // explicitly opted into. Off on every load.
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    initializeKnowledgeStoreIfNeeded();
    setEntries(getKnowledgeEntries());
  }, []);

  const refresh = () => setEntries(getKnowledgeEntries());

  const visibleEntries = useMemo(
    () => entries.filter((entry) => showDemo || entry.dataSource === 'manual'),
    [entries, showDemo],
  );

  const scopedEntries = useMemo(
    () =>
      visibleEntries.filter((entry) => {
        if (entry.status !== statusView) return false;
        if (scopeFilter !== 'all' && entry.scope !== scopeFilter) return false;
        if (scopeFilter === 'client' && clientFilter !== 'all' && entry.clientId !== clientFilter) return false;
        if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
        if (tagFilter && !entry.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) return false;
        return true;
      }),
    [visibleEntries, statusView, scopeFilter, clientFilter, typeFilter, tagFilter],
  );

  const filteredEntries = useMemo(() => searchKnowledgeEntries(scopedEntries, searchQuery), [scopedEntries, searchQuery]);

  // Coverage strip reflects the whole active (visible) store, not the
  // current filters — it's meant to answer "what do we have overall",
  // independent of what the user happens to be browsing right now. Demo
  // entries never contribute unless "Mostrar demo" is on.
  const summary = useMemo(() => summarizeKnowledgeEntries(visibleEntries), [visibleEntries]);

  const openCreate = () => {
    setDraft(emptyDraft());
    setActiveEntry(null);
    setSaveError(null);
    setPanelMode('create');
  };

  const openView = (entry: KnowledgeEntry) => {
    setActiveEntry(entry);
    setSaveError(null);
    setPanelMode('view');
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setActiveEntry(entry);
    setSaveError(null);
    setDraft({
      scope: entry.scope,
      clientId: entry.clientId ?? '',
      title: entry.title,
      type: entry.type,
      tags: entry.tags.join(', '),
      summary: entry.summary,
      content: entry.content,
      source: entry.source,
      sourceLabel: entry.sourceLabel ?? '',
    });
    setPanelMode('edit');
  };

  const closePanel = () => {
    setPanelMode('closed');
    setActiveEntry(null);
    setSaveError(null);
    setDraft(emptyDraft());
  };

  const submit = () => {
    const title = draft.title.trim();
    if (!title) return;
    if (draft.scope === 'client' && !draft.clientId) return;

    const payload = {
      scope: draft.scope,
      clientId: draft.scope === 'client' ? draft.clientId : null,
      title,
      type: draft.type,
      tags: draft.tags.split(',').map((tag) => tag.trim()),
      summary: draft.summary,
      content: draft.content,
      source: draft.source,
      sourceLabel: draft.sourceLabel || null,
    };

    try {
      if (panelMode === 'edit' && activeEntry) {
        const updated = updateKnowledgeEntry(activeEntry.id, payload);
        refresh();
        if (updated) openView(updated);
        return;
      }

      createKnowledgeEntry({ ...payload, dataSource: 'manual' });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la entrada de conocimiento.');
      return;
    }

    refresh();
    closePanel();
  };

  const handleArchive = (id: string) => {
    try {
      const updated = archiveKnowledgeEntry(id);
      refresh();
      if (updated) openView(updated);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo archivar la entrada.');
    }
  };

  const handleRestore = (id: string) => {
    try {
      const updated = restoreKnowledgeEntry(id);
      refresh();
      if (updated) openView(updated);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo restaurar la entrada.');
    }
  };

  return (
    <div className="mx-auto max-w-[1680px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">Memoria y conocimiento de REKREATIVE</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">G-Brain</h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
        >
          Nueva entrada
        </button>
      </div>

      {/* Search — the primary way to find something, deliberately large */}
      <div className="mb-6">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Buscar en título, resumen, contenido o tags…"
          className="w-full border border-os-border bg-os-surface px-4 py-3 text-sm text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong"
        />
      </div>

      {showDemo && (
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-os-warn">
          Incluye datos de demostración — no todo lo de abajo es conocimiento real
        </div>
      )}

      {/* Coverage strip — honest, cheaply-derived counts only, manual-only by default */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Entradas activas', value: String(summary.activeTotal) },
          { label: 'Internas', value: String(summary.internal) },
          { label: 'De clientes', value: String(summary.client) },
          { label: 'Clientes con conocimiento', value: `${summary.clientsWithKnowledge}/${clients.length}` },
          { label: 'Actualizadas (7d)', value: String(summary.recentlyUpdated) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[18px] font-semibold text-os-text">{tile.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">
          <input type="checkbox" checked={showDemo} onChange={(event) => setShowDemo(event.target.checked)} />
          Mostrar demo
        </label>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Ámbito</label>
          <select
            value={scopeFilter}
            onChange={(event) => {
              setScopeFilter(event.target.value as ScopeFilter);
              setClientFilter('all');
            }}
            className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            <option value="all">Todo</option>
            <option value="internal">REKREATIVE</option>
            <option value="client">Clientes</option>
          </select>
        </div>

        {scopeFilter === 'client' && (
          <div className="flex items-center gap-2">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
            >
              <option value="all">Todos</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Tipo</label>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as 'all' | KnowledgeType)}
            className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            <option value="all">Todos</option>
            {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {tagFilter && (
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className="border border-os-border-strong px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-accent"
          >
            #{tagFilter} ×
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {(['active', 'archived'] as StatusView[]).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setStatusView(view)}
              className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide ${
                statusView === view
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                  : 'border-transparent text-os-dim hover:text-os-muted'
              }`}
            >
              {view === 'active' ? 'Activas' : 'Archivadas'}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-10 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay conocimiento registrado todavía.
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-10 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay entradas que coincidan con estos filtros.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredEntries.map((entry) => (
            <KnowledgeCard key={entry.id} entry={entry} clients={clients} onOpen={() => openView(entry)} onTagClick={setTagFilter} />
          ))}
        </div>
      )}

      {panelMode !== 'closed' && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60">
          <div
            className="h-full w-full max-w-lg overflow-y-auto border-l border-os-border bg-os-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">
                {panelMode === 'create' ? 'Nueva entrada' : panelMode === 'edit' ? 'Editar entrada' : 'Conocimiento'}
              </h2>
              <button type="button" onClick={closePanel} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            {saveError && (
              <div className="mb-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{saveError}</div>
            )}

            {panelMode === 'view' && activeEntry && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-[16px] font-semibold text-os-text">{activeEntry.title}</div>
                  <div className="mt-1 font-mono text-[10px] text-os-dim">
                    {getClientNameForKnowledgeEntry(activeEntry.clientId, clients)} · {getKnowledgeTypeLabel(activeEntry.type)}
                  </div>
                </div>

                {activeEntry.summary && <p className="text-[13px] leading-relaxed text-os-muted">{activeEntry.summary}</p>}

                {activeEntry.content && (
                  <p className="whitespace-pre-wrap border-t border-os-border pt-3 text-[13px] leading-relaxed text-os-text">
                    {activeEntry.content}
                  </p>
                )}

                {activeEntry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeEntry.tags.map((tag) => (
                      <span key={tag} className="border border-os-border px-1.5 py-0.5 font-mono text-[9px] text-os-dim">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 border-t border-os-border pt-3 font-mono text-[10px]">
                  <div>
                    <div className="text-os-dim">Fuente</div>
                    <div className="mt-0.5 text-os-muted">
                      {getKnowledgeSourceLabel(activeEntry.source)}
                      {activeEntry.sourceLabel ? ` — ${activeEntry.sourceLabel}` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-os-dim">Estado</div>
                    <div className={`mt-0.5 ${activeEntry.status === 'archived' ? 'text-os-warn' : 'text-os-ok'}`}>
                      {activeEntry.status === 'archived' ? 'Archivado' : 'Activo'}
                    </div>
                  </div>
                  <div>
                    <div className="text-os-dim">Creado</div>
                    <div className="mt-0.5 text-os-muted">{formatDate(activeEntry.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-os-dim">Actualizado</div>
                    <div className="mt-0.5 text-os-muted">{formatDate(activeEntry.updatedAt)}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-os-border pt-3">
                  <span className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                    {activeEntry.dataSource === 'manual' ? 'manual' : 'demo'}
                  </span>
                  <div className="flex items-center gap-2">
                    {activeEntry.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => handleArchive(activeEntry.id)}
                        className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:border-os-warn hover:text-os-warn"
                      >
                        Archivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRestore(activeEntry.id)}
                        className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:border-os-ok hover:text-os-ok"
                      >
                        Restaurar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(activeEntry)}
                      className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface"
                    >
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(panelMode === 'create' || panelMode === 'edit') && (
              <div className="flex flex-col gap-3">
                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Ámbito</span>
                  <select
                    value={draft.scope}
                    onChange={(event) => setDraft((prev) => ({ ...prev, scope: event.target.value as KnowledgeScope, clientId: '' }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                  >
                    <option value="internal">Interno · REKREATIVE</option>
                    <option value="client">Cliente</option>
                  </select>
                </label>

                {draft.scope === 'client' && (
                  <label>
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

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Título</span>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Tipo</span>
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as KnowledgeType }))}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                    >
                      {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fuente</span>
                    <select
                      value={draft.source}
                      onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value as KnowledgeSource }))}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                    >
                      {KNOWLEDGE_SOURCE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
                    Detalle de la fuente <span className="normal-case text-os-dim">(opcional — no implica importación automática)</span>
                  </span>
                  <input
                    value={draft.sourceLabel}
                    onChange={(event) => setDraft((prev) => ({ ...prev, sourceLabel: event.target.value }))}
                    placeholder="p. ej. Reunión Acme — 12/08/2026"
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Tags (separados por comas)</span>
                  <input
                    value={draft.tags}
                    onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                    placeholder="p. ej. meta-ads, leads"
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Resumen</span>
                  <textarea
                    value={draft.summary}
                    onChange={(event) => setDraft((prev) => ({ ...prev, summary: event.target.value }))}
                    className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Contenido</span>
                  <textarea
                    value={draft.content}
                    onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                    className="h-40 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={closePanel} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface"
                  >
                    {panelMode === 'edit' ? 'Guardar cambios' : 'Crear entrada'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
