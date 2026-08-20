import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ContentBoard } from '@/components/ContentBoard';

export const dynamic = 'force-dynamic';

/**
 * REKREATIVE content production pipeline (Content V1). The FounderOS content
 * agent roster, Vantage Intel backlinks, and Zernio recent-posts feed that
 * used to live here have moved out of the primary view — they're real
 * systems, kept intact, just not what this page is about anymore. Reachable
 * from the links below instead of rendered as full dashboard sections.
 */
export default function ContentPage() {
  return (
    <div>
      <ContentBoard />

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-os-border pt-4 font-mono text-[10px] uppercase tracking-wide text-os-dim">
        <Link href="/content/lead-magnets" className="inline-flex items-center gap-1 hover:text-os-accent">
          Lead magnets <ArrowUpRight className="h-3 w-3" />
        </Link>
        <Link href="/social" className="inline-flex items-center gap-1 hover:text-os-accent">
          Pipeline Zernio (Social) <ArrowUpRight className="h-3 w-3" />
        </Link>
        <Link href="/agents" className="inline-flex items-center gap-1 hover:text-os-accent">
          Agentes de contenido <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
