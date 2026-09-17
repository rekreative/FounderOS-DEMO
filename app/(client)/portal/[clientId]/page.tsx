import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClientAccess } from '@/lib/server/auth';
import { getClientById } from '@/lib/server/clients-repo';
import { listLeads } from '@/lib/server/leads-repo';
import { getResults } from '@/lib/server/results-repo';

export const dynamic = 'force-dynamic';

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export default async function ClientWorkspacePage({ params }: { params: { clientId: string } }) {
  await requireClientAccess(params.clientId);

  const [client, leads, results] = await Promise.all([
    getClientById(params.clientId),
    listLeads({ clientId: params.clientId }),
    getResults({ clientId: params.clientId, preset: 'all' }),
  ]);
  if (!client) notFound();

  const upcoming = leads
    .filter((lead) => lead.appointmentDate && new Date(lead.appointmentDate).getTime() >= Date.now())
    .sort((a, b) => new Date(a.appointmentDate ?? 0).getTime() - new Date(b.appointmentDate ?? 0).getTime())
    .slice(0, 5);

  return (
    <section className="mx-auto max-w-6xl">
      <header className="flex flex-col gap-3 border-b border-os-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-os-accent">REKREATIVE · CLIENTE</p>
          <h1 className="mt-2 text-2xl font-semibold">{client.name}</h1>
          <p className="mt-1 text-sm text-os-dim">{client.service}</p>
        </div>
        <Link href="/portal" className="text-sm text-os-dim hover:text-os-text">Cambiar cuenta</Link>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Leads', String(results.overall.funnel.leads)],
          ['Cualificados', String(results.overall.funnel.qualified)],
          ['Citas', String(results.overall.funnel.appointments)],
          ['Valor generado', formatMoney(results.overall.value.total)],
        ].map(([label, value]) => (
          <div key={label} className="border border-os-border bg-os-surface p-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{label}</div>
            <div className="mt-2 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="border border-os-border bg-os-surface p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-os-muted">Leads recientes</h2>
          <div className="mt-3 divide-y divide-os-border">
            {leads.slice(0, 8).map((lead) => (
              <div key={lead.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{lead.name}</div>
                  <div className="mt-0.5 truncate text-xs text-os-dim">{lead.email ?? lead.phone ?? 'Sin contacto'}</div>
                </div>
                <span className="shrink-0 border border-os-border px-2 py-1 font-mono text-[9px] uppercase text-os-muted">{lead.stage}</span>
              </div>
            ))}
            {leads.length === 0 && <p className="py-5 text-sm text-os-dim">Aún no hay leads registrados.</p>}
          </div>
        </section>

        <section className="border border-os-border bg-os-surface p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-os-muted">Próximas citas</h2>
          <div className="mt-3 divide-y divide-os-border">
            {upcoming.map((lead) => (
              <div key={lead.id} className="py-3">
                <div className="text-sm font-medium">{lead.name}</div>
                <div className="mt-0.5 text-xs text-os-dim">
                  {new Date(lead.appointmentDate as string).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>
            ))}
            {upcoming.length === 0 && <p className="py-5 text-sm text-os-dim">No hay citas próximas.</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
