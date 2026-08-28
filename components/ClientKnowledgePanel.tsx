'use client';

import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api/http';
import { archiveKnowledgeEntry, createKnowledgeEntry, restoreKnowledgeEntry, updateKnowledgeEntry } from '@/lib/api/knowledge-entries';
import {
  KNOWLEDGE_SOURCE_OPTIONS,
  KNOWLEDGE_TYPE_OPTIONS,
  getKnowledgeSourceLabel,
  getKnowledgeTypeLabel,
  searchKnowledgeEntries,
  summarizeKnowledgeEntries,
  type KnowledgeEntry,
  type KnowledgeSource,
  type KnowledgeType,
} from '@/lib/knowledge-entries';

// Client-scoped G-Brain CRUD — reads/writes the SAME PostgreSQL-backed
// KnowledgeEntry store the global /brain board uses. The caller
// (app/(internal)/clients/[clientId]/page.tsx) fetches entries via
// getKnowledgeEntries(clientId) (lib/api/knowledge-entries.ts), which by
// construction excludes internal REKREATIVE knowledge and every other
// client's entries; this panel never queries the store itself, so it can
// never show anything outside that set. scope is always hardcoded to
// 'client' and clientId to the current workspace's clientId — there is no
// scope/client picker here, same discipline as components/ClientContentPanel.tsx.

type StatusView = 'active' | 'archived';

type DraftKnowledgeEntry = {
  title: string;
  type: KnowledgeType;
  tags: string;
  summary: string;
  content: string;
  source: KnowledgeSource;
  sourceLabel: string;
};

const emptyDraft = (): DraftKnowledgeEntry => ({
  title: '',
  type: 'client_context',
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

export function ClientKnowledgePanel({
  clientId,
  entries,
  onKnowledgeChanged,
}: {
  clientId: string;
  entries: KnowledgeEntry[];
  onKnowledgeChanged: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | KnowledgeType>('all');
  const [statusView, setStatusView] = useState<StatusView>('active');
  // G-Brain Truth V1: operational default is manual-only, same convention as
  // the global board (components/KnowledgeBoard.tsx) and Content
  // (components/ClientContentPanel.tsx) — off on every load.
  const [showDemo, setShowDemo] = useState(false);

  const [panelMode, setPanelMode] = useState<'closed' | 'view' | 'edit' | 'create'>('closed');
  const [activeEntry, setActiveEntry] = useState<KnowledgeEntry | null>(null);
  const [draft, setDraft] = useState<DraftKnowledgeEntry>(emptyDraft());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => showDemo || entry.dataSource === 'manual'),
    [entries, showDemo],
  );

  const summary = useMemo(() => summarizeKnowledgeEntries(visibleEntries), [visibleEntries]);

  const scopedEntries = useMemo(
    () =>
      visibleEntries.filter((entry) => {
        if (entry.status !== statusView) return false;
        if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
        return true;
      }),
    [visibleEntries, statusView, typeFilter],
  );

  const filteredEntries = useMemo(() => searchKnowledgeEntries(scopedEntries, searchQuery), [scopedEntries, searchQuery]);

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

  const submit = async () => {
    const title = draft.title.trim();
    if (!title) return;

    // scope/clientId are never user-editable here — the client context is
    // already known, and every write stays pinned to it.
    const payload = {
      scope: 'client' as const,
      clientId,
      title,
      type: draft.type,
      tags: draft.tags.split(',').map((tag) => tag.trim()),
      summary: draft.summary,
      content: draft.content,
      source: draft.source,
      sourceLabel: draft.sourceLabel || null,
    };

    setIsSaving(true);
    try {
      if (panelMode === 'edit' && activeEntry) {
        const updated = await updateKnowledgeEntry(activeEntry.id, payload);
        onKnowledgeChanged();
        openView(updated);
        return;
      }

      await createKnowledgeEntry(payload);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'No se pudo guardar la entrada de conocimiento.');
      return;
    } finally {
      setIsSaving(false);
    }

    onKnowledgeChanged();
    closePanel();
  };

  const handleArchive = async (id: string) => {
    setIsSaving(true);
    try {
      const updated = await archiveKnowledgeEntry(id);
      onKnowledgeChanged();
      openView(updated);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'No se pudo archivar la entrada.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = async (id: string) => {
    setIsSaving(true);
    try {
      const updated = await restoreKnowledgeEntry(id);
      onKnowledgeChanged();
      openView(updated);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'No se pudo restaurar la entrada.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Conocimiento</h3>
        <button
          type="button"
          onClick={openCreate}
          className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
        >
          Nueva entrada
        </button>
      </div>

      {showDemo && (
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-os-warn">
          Incluye datos de demostración — no todo lo de abajo es conocimiento real
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: 'Activas', value: String(summary.activeTotal) },
          { label: 'Actualizadas (7d)', value: String(summary.recentlyUpdated) },
          { label: 'Archivadas', value: String(visibleEntries.filter((entry) => entry.status === 'archived').length) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface2 px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{tile.value}</div>
          </div>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay conocimiento registrado para este cliente.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 border border-os-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
              <input type="checkbox" checked={showDemo} onChange={(event) => setShowDemo(event.target.checked)} />
              Mostrar demo
            </label>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar…"
              className="border border-os-border bg-transparent px-2 py-1 text-[12px] text-os-text outline-none placeholder:text-os-dim"
            />

            <div className="flex items-center gap-2">
              <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Tipo</label>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as 'all' | KnowledgeType)}
                className="border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text"
              >
                <option value="all">Todos</option>
                {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              {(['active', 'archived'] as StatusView[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setStatusView(view)}
                  className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-wide ${
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

          {filteredEntries.length === 0 ? (
            <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
              No hay entradas que coincidan con estos filtros.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => openView(entry)}
                  className="cursor-pointer border border-os-border bg-os-surface p-4 transition-colors hover:border-os-border-strong"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-os-text">{entry.title}</div>
                      <div className="mt-1 font-mono text-[10px] text-os-dim">
                        {getKnowledgeTypeLabel(entry.type)} · {getKnowledgeSourceLabel(entry.source)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[9.5px] text-os-dim">{formatDate(entry.updatedAt)}</div>
                  </div>
                  {entry.summary && <p className="mt-2 text-[12px] leading-relaxed text-os-muted">{entry.summary}</p>}
                  <div className="mt-3 flex items-center justify-between border-t border-os-border pt-2.5">
                    <span className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                      {entry.dataSource === 'manual' ? 'manual' : 'demo'}
                    </span>
                    {entry.status === 'archived' && (
                      <span className="font-mono text-[9px] uppercase tracking-wide text-os-warn">archivado</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {panelMode !== 'closed' && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={closePanel}>
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
                  <div className="mt-1 font-mono text-[10px] text-os-dim">{getKnowledgeTypeLabel(activeEntry.type)}</div>
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
                        disabled={isSaving}
                        className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:border-os-warn hover:text-os-warn disabled:opacity-50"
                      >
                        {isSaving ? 'Archivando…' : 'Archivar'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRestore(activeEntry.id)}
                        disabled={isSaving}
                        className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:border-os-ok hover:text-os-ok disabled:opacity-50"
                      >
                        {isSaving ? 'Restaurando…' : 'Restaurar'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(activeEntry)}
                      disabled={isSaving}
                      className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface disabled:opacity-50"
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
                    placeholder="p. ej. Reunión — 12/08/2026"
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                  />
                </label>

                <label>
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Tags (separados por comas)</span>
                  <input
                    value={draft.tags}
                    onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                    placeholder="p. ej. onboarding, contexto"
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
                  <button
                    type="button"
                    onClick={closePanel}
                    disabled={isSaving}
                    className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={isSaving}
                    className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface disabled:opacity-50"
                  >
                    {isSaving ? 'Guardando…' : panelMode === 'edit' ? 'Guardar cambios' : 'Crear entrada'}
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
