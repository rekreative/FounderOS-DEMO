import { BrandLogo } from '@/lib/brand-logos';
import type { CatalogEntry } from '@/lib/integrations-catalog';

/**
 * One integration tile in the read-only connections marketplace: rounded
 * card, brand logo, name + blurb, and a status line — `connected` always
 * comes from the real connector, never a stored key. No Connect/Disconnect/
 * Save affordance exists anywhere on this card (Legacy secret-write
 * shutdown, Connections/Secrets V1) — secrets are configured outside
 * REKREOS (Railway Variables in production, .env.local locally).
 */
export function ConnectionCard({ entry, guidance }: { entry: CatalogEntry; guidance?: string }) {
  return (
    <div className="group flex min-h-[112px] flex-col justify-between rounded-2xl border border-os-border bg-os-surface p-4 transition-colors hover:border-os-border-strong">
      <div className="flex items-start gap-3">
        <BrandLogo slug={entry.slug} name={entry.name} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[13.5px] font-semibold leading-tight text-os-text">{entry.name}</div>
          <div className="mt-1 truncate text-[11px] leading-tight text-os-dim">{entry.tagline}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {entry.connected ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-os-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-os-ok" />
            Connected
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-os-dim">Not connected</span>
        )}
        {guidance && <span className="truncate pl-2 text-right text-[10px] text-os-dim" title={guidance}>{guidance}</span>}
      </div>
    </div>
  );
}
