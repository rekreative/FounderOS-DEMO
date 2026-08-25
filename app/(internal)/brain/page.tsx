import { KnowledgeBoard } from '@/components/KnowledgeBoard';

export const dynamic = 'force-dynamic';

/**
 * REKREATIVE G-Brain V1 (2026-08-20): structured institutional memory —
 * decisions, learnings, SOPs, strategy, client context — replaces the
 * FounderOS personal capture/graph/CLI experience as the visible /brain
 * surface. That system (real gbrain CLI, markdown brain-store, knowledge
 * graph, memory constellation) is untouched, just relocated to
 * /brain/legacy — kept for preservation/debugging only, reachable by
 * direct URL, deliberately not linked from here or from primary nav.
 */
export default function BrainPage() {
  return (
    <div>
      <KnowledgeBoard />
    </div>
  );
}
