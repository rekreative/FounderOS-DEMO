'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONTENT_FORMAT_OPTIONS,
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_STATUS_OPTIONS,
  createContentItem,
  deleteContentItem,
  getContentFormatLabel,
  getContentItems,
  getContentPlatformLabel,
  initializeContentStoreIfNeeded,
  isContentOverdue,
  setContentStatus,
  summarizeContentItems,
  updateContentItem,
  type ContentFormat,
  type ContentItem,
  type ContentPlatform,
  type ContentStatus,
} from '@/lib/content-items';

// REKREATIVE's own production workspace. Global /content is internal-only —
// client content lives in Client Workspace → Contenido, reading the SAME
// ContentItem store filtered by clientId (see ClientContentPanel). This
// board never touches client-scoped items: it reads the full store and
// filters to scope === 'internal' client-side, same one-store architecture
// as before, just a narrower slice of it.
//
// "En producción" is the primary view: the 5 active statuses as lightweight
// columns (no drag-and-drop — the same inline status <select> every
// REKREATIVE module uses). Publicado/Archivado are flat grids, not columns —
// there's only one status in each, so a Kanban lane would be one giant empty
// box. This is a presentation grouping only; published/cancelled ARE NOT new
// statuses and nothing here changes what CONTENT_STATUS_OPTIONS holds.

type ContentView = 'production' | 'published' | 'archived';

const PRODUCTION_COLUMNS = CONTENT_STATUS_OPTIONS.filter(
  (option) => option.id !== 'published' && option.id !== 'cancelled',
);

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
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function ContentCard({
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
    <div className="flex flex-col gap-3 border border-os-border bg-os-surface p-4">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold leading-snug text-os-text">{item.title}</div>
        {preview && (
          <p className="mt-1.5 line-clamp-2 text-[11.5px] italic leading-relaxed text-os-muted">
            &ldquo;{preview}&rdquo;
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
          {getContentFormatLabel(item.format)}
        </span>
        <span className="border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
          {getContentPlatformLabel(item.platform)}
        </span>
      </div>

      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="truncate text-os-dim">{item.owner || 'Sin responsable'}</span>
        <span className={overdue ? 'font-semibold text-os-err' : 'text-os-muted'}>
          {overdue ? '● ' : ''}
          {formatDate(item.plannedPublishDate)}
        </span>
      </div>

      <select
        value={item.status}
        onChange={(event) => onStatusChange(event.target.value as ContentStatus)}
        className={`w-full border border-os-border bg-transparent px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide outline-none ${STATUS_TONE_CLASS[item.status]}`}
      >
        {CONTENT_STATUS_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} className="text-os-text">
            {option.label}
          </option>
        ))}
      </select>

      <div className="flex items-center justify-between border-t border-os-border pt-2.5">
        <span className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
          {item.dataSource === 'manual' ? 'manual' : 'demo'}
        </span>
        <div className="flex items-center gap-2.5">
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

const VIEW_OPTIONS: { id: ContentView; label: string }[] = [
  { id: 'production', label: 'En producción' },
  { id: 'published', label: 'Publicado' },
  { id: 'archived', label: 'Archivado' },
];

export function ContentBoard() {
  const [items, setItems] = useState<ContentItem[]>([]);

  const [view, setView] = useState<ContentView>('production');
  const [formatFilter, setFormatFilter] = useState<'all' | ContentFormat>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | ContentPlatform>('all');
  const [ownerFilter, setOwnerFilter] = useState<'all' | string>('all');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftContentItem>(emptyDraft());

  useEffect(() => {
    initializeContentStoreIfNeeded();
    setItems(getContentItems());
  }, []);

  const internalItems = useMemo(() => items.filter((item) => item.scope === 'internal'), [items]);

  const owners = useMemo(
    () => Array.from(new Set(internalItems.map((item) => item.owner).filter(Boolean))).sort(),
    [internalItems],
  );

  const filteredItems = useMemo(
    () =>
      internalItems.filter((item) => {
        if (formatFilter !== 'all' && item.format !== formatFilter) return false;
        if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
        if (ownerFilter !== 'all' && item.owner !== ownerFilter) return false;
        return true;
      }),
    [internalItems, formatFilter, platformFilter, ownerFilter],
  );

  // KPI strip stays an overview of the whole (filtered) internal set,
  // independent of which view tab is open — switching tabs shouldn't make
  // these numbers jump around.
  const summary = useMemo(() => summarizeContentItems(filteredItems), [filteredItems]);

  const viewItems = useMemo(() => {
    if (view === 'published') return filteredItems.filter((item) => item.status === 'published');
    if (view === 'archived') return filteredItems.filter((item) => item.status === 'cancelled');
    return filteredItems.filter((item) => item.status !== 'published' && item.status !== 'cancelled');
  }, [filteredItems, view]);

  const refresh = () => setItems(getContentItems());

  const openCreateForm = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (item: ContentItem) => {
    setEditingId(item.id);
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
    setDraft(emptyDraft());
  };

  const submit = () => {
    const title = draft.title.trim();
    const owner = draft.owner.trim();
    if (!title || !owner) return;

    const payload = {
      scope: 'internal' as const,
      clientId: null,
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

    if (editingId) {
      updateContentItem(editingId, payload);
    } else {
      createContentItem({ ...payload, dataSource: 'manual' });
    }

    refresh();
    closeForm();
  };

  const handleStatusChange = (id: string, next: ContentStatus) => {
    setContentStatus(id, next);
    refresh();
  };

  const handleDelete = (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar esta pieza de contenido? Esta acción no se puede deshacer.')) return;
    deleteContentItem(id);
    refresh();
  };

  return (
    <div className="mx-auto max-w-[1680px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">Producción de REKREATIVE</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Contenido</h1>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
        >
          Nueva pieza
        </button>
      </div>

      {/* KPI summary */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'En producción', value: String(summary.active) },
          { label: 'Listas', value: String(summary.ready) },
          { label: 'Atrasadas', value: String(summary.overdue), tone: summary.overdue > 0 ? 'text-os-err' : undefined },
          { label: 'Publicadas', value: String(summary.published) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className={`mt-1.5 font-mono text-[18px] font-semibold ${tile.tone ?? 'text-os-text'}`}>{tile.value}</div>
          </div>
        ))}
      </div>

      {/* Filters — internal-only surface, so no client selector */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Formato</label>
          <select
            value={formatFilter}
            onChange={(event) => setFormatFilter(event.target.value as 'all' | ContentFormat)}
            className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
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
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Plataforma</label>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as 'all' | ContentPlatform)}
            className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
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
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Responsable</label>
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="border border-os-border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
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

      {/* View selector */}
      <div className="mb-6 flex items-center gap-1.5 border-b border-os-border pb-4">
        {VIEW_OPTIONS.map((option) => {
          const active = view === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide ${
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
        <div className="border border-dashed border-os-border px-3 py-10 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay contenido en este segmento.
        </div>
      ) : view === 'production' ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-flow-col auto-cols-[300px] gap-6">
            {PRODUCTION_COLUMNS.map((column) => {
              const columnItems = viewItems.filter((item) => item.status === column.id);
              return (
                <div key={column.id} className="flex flex-col gap-4">
                  <div className="flex items-baseline justify-between gap-2 border-b border-os-border pb-2">
                    <span className={`font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] ${STATUS_TONE_CLASS[column.id]}`}>
                      {column.label}
                    </span>
                    <span className="font-mono text-[10px] text-os-dim">{columnItems.length}</span>
                  </div>

                  <div className="flex flex-col gap-4">
                    {columnItems.map((item) => (
                      <ContentCard
                        key={item.id}
                        item={item}
                        onStatusChange={(next) => handleStatusChange(item.id, next)}
                        onEdit={() => openEditForm(item)}
                        onDelete={() => handleDelete(item.id)}
                      />
                    ))}

                    {columnItems.length === 0 && (
                      <div className="border border-dashed border-os-border px-2 py-6 text-center font-mono text-[9px] uppercase tracking-wide text-os-dim">
                        vacío
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {viewItems.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              onStatusChange={(next) => handleStatusChange(item.id, next)}
              onEdit={() => openEditForm(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
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
