'use client';

// Notes tab — unchanged behavior/storage from the prior inline implementation
// (rek_client_notes_v1 via lib/clients.ts's getClientNotes/updateClientNotes),
// only extracted out of app/clients/[clientId]/page.tsx to keep that file from
// growing into a monolith as the other tabs gained real content.

export function ClientNotesPanel({
  notes,
  notesDirty,
  onChange,
  onSave,
}: {
  notes: string;
  notesDirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Notas</h3>
      <div className="space-y-2">
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Añade notas sobre este cliente..."
          className="w-full h-40 p-3 border border-os-border bg-transparent text-white font-mono text-sm resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={onSave}
            disabled={!notesDirty}
            className={`px-3 py-1 ${
              notesDirty
                ? 'bg-os-accent text-black cursor-pointer'
                : 'bg-os-surface2 text-os-dim border border-os-border cursor-not-allowed'
            }`}
          >
            {notesDirty ? 'Guardar' : 'Guardado'}
          </button>
        </div>
      </div>
    </div>
  );
}
