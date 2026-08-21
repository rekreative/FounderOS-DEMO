import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ContentBoard } from '@/components/ContentBoard';
import { Label } from '@/components/terminal';

export const dynamic = 'force-dynamic';

/**
 * REKREATIVE content production pipeline (Content V1) — REKREATIVE's own
 * internal content workspace; client content lives at
 * /clients/[clientId] → Contenido instead, by route/context, never a scope
 * toggle here. The legacy FounderOS content agent roster and Zernio
 * Social pipeline that used to be linked from here are real systems, kept
 * intact at their legacy routes, but are FounderOS/Zernio demo surfaces,
 * not REKREATIVE OS — no longer part of normal Content navigation. Lead
 * Magnets is the one legacy-adjacent tool that IS a REKREATIVE
 * acquisition/content utility, so it stays, framed as secondary.
 */
export default function ContentPage() {
  return (
    <div>
      <ContentBoard />

      <div className="mt-8 border-t border-os-border pt-4">
        <Label>Herramientas</Label>
        <Link
          href="/content/lead-magnets"
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent"
        >
          Lead Magnets <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
