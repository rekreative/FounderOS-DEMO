'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CONTENT_FORMAT_OPTIONS,
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_STATUS_OPTIONS,
  createContentItem,
  deleteContentItem,
  getContentFormatLabel,
  getContentPlatformLabel,
  isContentOverdue,
  setContentStatus,
  summarizeContentItems,
  updateContentItem,
  type ContentFormat,
  type ContentItem,
  type ContentPlatform,
  type ContentStatus,
} from '@/lib/content-items';

// Client-scoped Content CRUD — reads/writes the SAME ContentItem store the
// global /content board uses. The caller (app/clients/[clientId]/page.tsx)
// fetches items via getContentItems(clientId), which by construction
// excludes internal REKREATIVE content and every other client's items; this
// panel never queries the store itself, so it can never show anything
// outside that set. Every write here goes through the shared
// createContentItem/updateContentItem/setContentStatus/deleteContentItem —
// scope is always hardcoded to 'client' and clientId to the current
// workspace's clientId, so there is no scope/client picker to get wrong.
//
// Same "En producción / Publicado / Archivado" presentation grouping as the
// global board (see components/ContentBoard.tsx) — a flat list per view
// rather than a multi-column board, since this panel sits inside a narrower
// client-workspace tab.

type ContentView = 'production' | 'published' | 'archived';

const VIEW_OPTIONS: { id: ContentView; label: string }[] = [
  { id: 'production', label: 'En producción' },
  { id: 'published', label: 'Publicado' },
  { id: 'archived', label: 'Archivado' },
];

const STATUS_TONE_CLASS: Record<ContentStatus, string> = {
  idea: 'text-os-dim',
  scripting: 'text-os-dim',
  recording: 'text-os-warn',
  editing: 'text-os-warn',
  ready: 'text-os-accent',
  published: 'text-os-ok',
  cancelled: 'text-os-err',
};

type DraftContentItem = {
  title: string;
  format: ContentFormat;
  platform: ContentPlatform;
  status: ContentStatus;
  pillar: string;
  hook: string;
  angle: string;
  script: string;
  notes: string;
  owner: string;
  plannedPublishDate: string;
};

const emptyDraft = (): DraftContentItem => ({
  title: '',
  format: 'reel',
  platform: 'instagram',
  status: 'idea',
  pillar: '',
  hook: '',
  angle: '',
  script: '',
  notes: '',
  owner: '',
  plannedPublishDate: '',
});

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ContentRow({
  item,
  onStatusChange,
  onEdit,
  onDelete,
}: {
  item: ContentItem;
  onStatusChange: (next: ContentStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue = isContentOverdue(item);
  const preview = item.hook || item.angle;

  return (
    <div className="border border-os-border bg-os-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-os-text">{item.title}</div>
          <div className="mt-1 font-mono text-[10px] text-os-dim">
            {getContentFormatLabel(item.format)} · {getContentPlatformLabel(item.platform)}
            {item.pillar ? ` · ${item.pillar}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Responsable</div>
          <div className="mt-0.5 font-mono text-[9.5px] text-os-muted">{item.owner || '—'}</div>
          <div className={`mt-1 font-mono text-[9.5px] ${overdue ? 'font-semibold text-os-err' : 'text-os-dim'}`}>
            {overdue ? '● ' : ''}
            {formatDate(item.plannedPublishDate)}
          </div>
        </div>
      </div>

      {preview && <p className="mt-2 text-[12px] leading-relaxed text-os-muted">&ldquo;{preview}&rdquo;</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-os-border pt-2.5">
        <select
          value={item.status}
          onChange={(event) => onStatusChange(event.target.value as ContentStatus)}
          className={`border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide outline-none ${STATUS_TONE_CLASS[item.status]}`}
        >
          {CONTENT_STATUS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id} className="text-os-text">
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
            {item.dataSource === 'manual' ? 'manual' : 'demo'}
          </span>
          <button type="button" onClick={onEdit} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
            editar
          </button>
          <button type="button" onClick={onDelete} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-err">
            eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientContentPanel({
  clientId,
  items,
  onContentChanged,
}: {
  clientId: string;
  items: ContentItem[];
  onContentChanged: () => void;
}) {
  const [view, setView] = useState<ContentView>('production');
  const [formatFilter, setFormatFilter] = useState<'all' | ContentFormat>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | ContentPlatform>('all');
  const [ownerFilter, setOwnerFilter] = useState<'all' | string>('all');
  // Content Truth V1: operational default is manual-only, same convention as
  // the global board (components/ContentBoard.tsx) — off on every load.
  const [showDemo, setShowDemo] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftContentItem>(emptyDraft());
  const [saveError, setSaveError] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => items.filter((item) => showDemo || item.dataSource === 'manual'),
    [items, showDemo],
  );

  const owners = useMemo(
    () => Array.from(new Set(visibleItems.map((item) => item.owner).filter(Boolean))).sort(),
    [visibleItems],
  );

  const filteredItems = useMemo(
    () =>
      visibleItems.filter((item) => {
        if (formatFilter !== 'all' && item.format !== formatFilter) return false;
        if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
        if (ownerFilter !== 'all' && item.owner !== ownerFilter) return false;
        return true;
      }),
    [visibleItems, formatFilter, platformFilter, ownerFilter],
  );

  // KPI strip is an overview of the (filtered) client set, independent of
  // which view tab is open — same convention as the global board. Reuses
  // summarizeContentItems directly; no duplicate summary logic here.
  const summary = useMemo(() => summarizeContentItems(filteredItems), [filteredItems]);

  const viewItems = useMemo(() => {
    if (view === 'published') return filteredItems.filter((item) => item.status === 'published');
    if (view === 'archived') return filteredItems.filter((item) => item.status === 'cancelled');
    return filteredItems.filter((item) => item.status !== 'published' && item.status !== 'cancelled');
  }, [filteredItems, view]);

  const openCreateForm = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setSaveError(null);
    setShowForm(true);
  };

  const openEditForm = (item: ContentItem) => {
    setEditingId(item.id);
    setSaveError(null);
    setDraft({
      title: item.title,
      format: item.format,
      platform: item.platform,
      status: item.status,
      pillar: item.pillar ?? '',
      hook: item.hook,
      angle: item.angle,
      script: item.script,
      notes: item.notes,
      owner: item.owner,
      plannedPublishDate: item.plannedPublishDate ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setSaveError(null);
    setDraft(emptyDraft());
  };

  const submit = () => {
    const title = draft.title.trim();
    const owner = draft.owner.trim();
    if (!title || !owner) return;

    // scope/clientId are never user-editable here — the client context is
    // already known, and every write stays pinned to it.
    const payload = {
      scope: 'client' as const,
      clientId,
      title,
      format: draft.format,
      platform: draft.platform,
      status: draft.status,
      pillar: draft.pillar.trim() || null,
      hook: draft.hook,
      angle: draft.angle,
      script: draft.script,
      notes: draft.notes,
      owner,
      plannedPublishDate: draft.plannedPublishDate || null,
    };

    try {
      if (editingId) {
        updateContentItem(editingId, payload);
      } else {
        createContentItem({ ...payload, dataSource: 'manual' });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la pieza de contenido.');
      return;
    }

    onContentChanged();
    closeForm();
  };

  const handleStatusChange = (id: string, next: ContentStatus) => {
    setContentStatus(id, next);
    onContentChanged();
  };

  const handleDelete = (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar esta pieza de contenido? Esta acción no se puede deshacer.')) return;
    deleteContentItem(id);
    onContentChanged();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Contenido</h3>
        <div className="flex items-center gap-3">
          <Link href="/content" className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent">
            Ver contenido de REKREATIVE →
          </Link>
          <button
            type="button"
            onClick={openCreateForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nueva pieza
          </button>
        </div>
      </div>

      {showDemo && (
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-os-warn">
          Incluye datos de demostración — no todo lo de abajo es producción real
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Activas', value: String(summary.active) },
          { label: 'Atrasadas', value: String(summary.overdue), tone: summary.overdue > 0 ? 'text-os-err' : undefined },
          { label: 'Listas', value: String(summary.ready) },
          { label: 'Publicadas', value: String(summary.published) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface2 px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
            <div className={`mt-1.5 font-mono text-[15px] font-semibold ${tile.tone ?? 'text-os-text'}`}>{tile.value}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin contenido para este cliente.
        </div>
      ) : (
        <>
          {/* Compact filters — client is already fixed by this workspace, so no client selector */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 border border-os-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
              <input type="checkbox" checked={showDemo} onChange={(event) => setShowDemo(event.target.checked)} />
              Mostrar demo
            </label>
            <div className="flex items-center gap-2">
              <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Formato</label>
              <select
                value={formatFilter}
                onChange={(event) => setFormatFilter(event.target.value as 'all' | ContentFormat)}
                className="border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text"
              >
                <option value="all">Todos</option>
                {CONTENT_FORMAT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Plataforma</label>
              <select
                value={platformFilter}
                onChange={(event) => setPlatformFilter(event.target.value as 'all' | ContentPlatform)}
                className="border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text"
              >
                <option value="all">Todas</option>
                {CONTENT_PLATFORM_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Responsable</label>
              <select
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                className="border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-text"
              >
                <option value="all">Todos</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-1.5 border-b border-os-border pb-3">
            {VIEW_OPTIONS.map((option) => {
              const active = view === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setView(option.id)}
                  className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-wide ${
                    active
                      ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                      : 'border-transparent text-os-dim hover:text-os-muted'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {viewItems.length === 0 ? (
            <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
              No hay contenido en este segmento.
            </div>
          ) : (
            <div className="space-y-3">
              {viewItems.map((item) => (
                <ContentRow
                  key={item.id}
                  item={item}
                  onStatusChange={(next) => handleStatusChange(item.id, next)}
                  onEdit={() => openEditForm(item)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingId ? 'Editar pieza' : 'Nueva pieza de contenido'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Título</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Formato</span>
                <select
                  value={draft.format}
                  onChange={(event) => setDraft((prev) => ({ ...prev, format: event.target.value as ContentFormat }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {CONTENT_FORMAT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Plataforma</span>
                <select
                  value={draft.platform}
                  onChange={(event) => setDraft((prev) => ({ ...prev, platform: event.target.value as ContentPlatform }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {CONTENT_PLATFORM_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Estado</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as ContentStatus }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {CONTENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Pilar</span>
                <input
                  value={draft.pillar}
                  onChange={(event) => setDraft((prev) => ({ ...prev, pillar: event.target.value }))}
                  placeholder="p. ej. Educativo"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Responsable</span>
                <input
                  value={draft.owner}
                  onChange={(event) => setDraft((prev) => ({ ...prev, owner: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fecha planificada</span>
                <input
                  type="date"
                  value={draft.plannedPublishDate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, plannedPublishDate: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Hook</span>
                <input
                  value={draft.hook}
                  onChange={(event) => setDraft((prev) => ({ ...prev, hook: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Ángulo / concepto</span>
                <textarea
                  value={draft.angle}
                  onChange={(event) => setDraft((prev) => ({ ...prev, angle: event.target.value }))}
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Guion</span>
                <textarea
                  value={draft.script}
                  onChange={(event) => setDraft((prev) => ({ ...prev, script: event.target.value }))}
                  className="h-28 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Notas</span>
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            {saveError && (
              <div className="mt-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{saveError}</div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submit} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingId ? 'Guardar pieza' : 'Crear pieza'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
