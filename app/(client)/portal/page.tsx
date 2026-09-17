import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { listAccessibleClients } from '@/lib/server/profiles-repo';

export const dynamic = 'force-dynamic';

/** Client account landing. A single grant goes straight to its workspace;
 * multiple grants present an explicit picker rather than guessing a tenant. */
export default async function ClientPortalPage() {
  const user = await requireUser();
  const clients = await listAccessibleClients(user.id);

  if (clients.length === 1) redirect(`/portal/${encodeURIComponent(clients[0].id)}`);

  return (
    <section className="mx-auto max-w-3xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-os-accent">REKREATIVE</p>
      <h1 className="mt-2 text-2xl font-semibold">Tu espacio de trabajo</h1>
      <p className="mt-2 text-sm text-os-dim">Selecciona la cuenta que quieres revisar.</p>

      {clients.length === 0 ? (
        <div className="mt-6 border border-os-warn bg-os-surface p-4 text-sm text-os-muted">
          Tu usuario todavía no tiene una cuenta asignada. Contacta con REKREATIVE para activarla.
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/portal/${encodeURIComponent(client.id)}`}
              className="border border-os-border bg-os-surface p-4 transition-colors hover:border-os-border-strong hover:bg-os-surface2"
            >
              <div className="text-base font-semibold">{client.name}</div>
              <div className="mt-1 text-sm text-os-dim">{client.service}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
