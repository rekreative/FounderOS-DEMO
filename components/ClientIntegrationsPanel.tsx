'use client';

import Link from 'next/link';
import {
  buildClientRequirementRows,
  getIntegrationRequirementLevelLabel,
  getRequirementConnectionScopeLabel,
  getRequirementStateLabel,
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
  type RequirementConnectionState,
} from '@/lib/client-integration-requirements';
import {
  getIntegrationConfigurationStatus,
  getIntegrationConfigurationStatusLabel,
  getIntegrationPlatformLabel,
  getIntegrationVerificationStatusLabel,
  type IntegrationConnection,
} from '@/lib/integration-connections';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Integraciones tab — NEW to the client workspace. Reads the
// SAME ClientIntegrationRequirement + IntegrationConnection stores the global
// /connections page uses; no client-specific integration store. Per
// buildClientRequirementRows' documented contract, `connections` must include
// this client's OWN connections AND every internal (REKREATIVE-shared)
// connection — the caller (this component) filters the full connection list
// down to exactly that set, so a connectionScope='internal' requirement
// (e.g. Make, OpenAI) is satisfied by REKREATIVE's shared connection instead
// of demanding — or fabricating — a duplicate client-owned one.
//
// Configuration state and verification state are rendered as two distinct
// columns/badges throughout — never collapsed into a single "connected"
// concept, per lib/integration-connections.ts's honesty rule.

const STATE_TONE: Record<RequirementConnectionState, BadgeTone> = {
  pending: 'warn',
  incomplete: 'warn',
  configured: 'ok',
};

const VERIFICATION_TONE: Record<IntegrationConnection['verificationStatus'], BadgeTone> = {
  not_verified: 'default',
  verified: 'ok',
  failed: 'err',
};

export function ClientIntegrationsPanel({
  clientId,
  requirements,
  allConnections,
  loading,
  error,
}: {
  clientId: string;
  requirements: ClientIntegrationRequirement[];
  /** The FULL connection list (not pre-filtered to this client) — this
   *  component derives the client-plus-internal subset itself, matching
   *  buildClientRequirementRows' documented contract. */
  allConnections: IntegrationConnection[];
  /** True while the parent's integration-connections fetch is in flight —
   *  gates the requirement table so a client mid-load never reads as "no
   *  integrations configured" (allConnections is [] during loading exactly
   *  like it would be for a client with genuinely zero connections). */
  loading: boolean;
  /** Set when the parent's integration-connections fetch failed — this tab
   *  gets its own controlled error, independent of the rest of the client
   *  workspace (other tabs must keep working). */
  error: string | null;
}) {
  const relevantConnections = allConnections.filter(
    (connection) => connection.clientId === clientId || connection.scope === 'internal',
  );
  const rows = buildClientRequirementRows(requirements, relevantConnections);
  const summary = summarizeClientOnboarding(clientId, requirements, relevantConnections);

  const requiredRows = rows.filter((row) => row.requirement === 'required');
  const optionalRows = rows.filter((row) => row.requirement === 'optional');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Integraciones</h3>
        <Link
          href="/connections"
          className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
        >
          Ver en Integraciones →
        </Link>
      </div>

      {error ? (
        <div className="border border-os-err/40 bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{error}</div>
      ) : loading ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Cargando integraciones…
        </div>
      ) : requirements.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin plan de onboarding definido para este cliente.
        </div>
      ) : (
        <>
          {/* A. Technical onboarding progress */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
                Requeridas configuradas
              </div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">
                {summary.requiredConfigured}/{summary.requiredTotal}
              </div>
            </div>
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Progreso</div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">
                {summary.progressPercent == null ? '—' : `${summary.progressPercent}%`}
              </div>
            </div>
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Pendientes</div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{summary.requiredPending}</div>
            </div>
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Incidencias</div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{summary.incidents}</div>
            </div>
          </div>

          {/* B + C + D. Requirement rows: level, connection scope, configuration state, verification state */}
          <div className="overflow-hidden border border-os-border bg-os-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
                  <th className="px-3 py-2 font-normal">Plataforma</th>
                  <th className="px-3 py-2 font-normal">Requisito</th>
                  <th className="px-3 py-2 font-normal">Propietario</th>
                  <th className="px-3 py-2 font-normal">Estado</th>
                  <th className="px-3 py-2 font-normal">Configuración</th>
                  <th className="px-3 py-2 font-normal">Verificación</th>
                </tr>
              </thead>
              <tbody>
                {[...requiredRows, ...optionalRows].map((row) => {
                  const configStatus = row.connection ? getIntegrationConfigurationStatus(row.connection) : null;
                  return (
                    <tr key={row.platform} className="border-t border-os-border">
                      <td className="px-3 py-2.5 text-[13px] font-semibold text-os-text">
                        {getIntegrationPlatformLabel(row.platform)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">
                        {getIntegrationRequirementLevelLabel(row.requirement)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">
                        {getRequirementConnectionScopeLabel(row.connectionScope)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={STATE_TONE[row.state]}>{getRequirementStateLabel(row.state, row.requirement)}</Badge>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">
                        {configStatus ? getIntegrationConfigurationStatusLabel(configStatus) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.connection ? (
                          <Badge tone={VERIFICATION_TONE[row.connection.verificationStatus]}>
                            {getIntegrationVerificationStatusLabel(row.connection)}
                          </Badge>
                        ) : (
                          <span className="font-mono text-[10.5px] text-os-dim">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
