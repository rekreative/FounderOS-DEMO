'use client';

import React, { useState } from 'react';
import type { Client, ClientStatus } from '@/lib/clients';

export type NewClientInput = {
  name: string;
  sector: string;
  status: ClientStatus;
  service: string;
  metaBudgetMonthly: number;
  startDate: string;
  owner: string;
};

export function ClientsForm({
  mode = 'create',
  initialData,
  onCancel,
  onCreate,
  onUpdate,
}: {
  mode?: 'create' | 'edit';
  initialData?: Client;
  onCancel: () => void;
  onCreate?: (data: NewClientInput) => void;
  onUpdate?: (data: NewClientInput) => void;
}) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [sector, setSector] = useState(initialData?.sector ?? '');
  const [status, setStatus] = useState<ClientStatus>(initialData?.status ?? 'active');
  const [service, setService] = useState(initialData?.service ?? '');
  const [metaBudgetMonthly, setMetaBudgetMonthly] = useState<number>(initialData?.metaBudgetMonthly ?? 0);
  const [startDate, setStartDate] = useState<string>(initialData?.startDate ?? new Date().toISOString().slice(0, 10));
  const [owner, setOwner] = useState(initialData?.owner ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!name.trim()) return setError('El nombre del cliente es obligatorio');
    if (!sector.trim()) return setError('El sector es obligatorio');
    if (isNaN(metaBudgetMonthly) || metaBudgetMonthly < 0) return setError('El presupuesto debe ser un número ≥ 0');
    
    const data: NewClientInput = {
      name: name.trim(),
      sector: sector.trim(),
      status,
      service: service.trim(),
      metaBudgetMonthly,
      startDate,
      owner: owner.trim(),
    };

    if (mode === 'create' && onCreate) {
      onCreate(data);
    } else if (mode === 'edit' && onUpdate) {
      onUpdate(data);
    }
  }

  const title = mode === 'create' ? 'Nuevo cliente' : 'Editar cliente';
  const submitLabel = mode === 'create' ? 'Crear' : 'Guardar';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <form onSubmit={submit} className="relative w-full max-w-xl bg-os-surface border border-os-border p-4 rounded-md">
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[12px] text-os-dim">Nombre</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[12px] text-os-dim">Sector</div>
            <input value={sector} onChange={(e) => setSector(e.target.value)} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[12px] text-os-dim">Estado</div>
            <select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)} className="w-full bg-transparent border border-os-border px-2 py-1">
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="prospect">Prospecto</option>
            </select>
          </label>
          <label className="block">
            <div className="text-[12px] text-os-dim">Servicio</div>
            <input value={service} onChange={(e) => setService(e.target.value)} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[12px] text-os-dim">Presupuesto mensual Meta</div>
            <input type="number" value={metaBudgetMonthly} onChange={(e) => setMetaBudgetMonthly(Number(e.target.value || 0))} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
          <label className="block">
            <div className="text-[12px] text-os-dim">Fecha de inicio</div>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
          <label className="block col-span-2">
            <div className="text-[12px] text-os-dim">Responsable</div>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full bg-transparent border border-os-border px-2 py-1" />
          </label>
        </div>
        {error && <div className="mt-2 text-os-err">{error}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1 border border-os-border">Cancelar</button>
          <button type="submit" className="px-3 py-1 bg-os-accent text-black">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
