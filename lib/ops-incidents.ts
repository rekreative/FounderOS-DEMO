/** Client-safe operational incidents. Values are derived from server-side
 * evidence and deliberately contain no provider credentials or lead PII. */
export type OpsIncidentCategory = 'meta' | 'whatsapp' | 'mapping';
export type OpsIncidentSeverity = 'critical' | 'warning';

export type OpsIncident = {
  id: string;
  category: OpsIncidentCategory;
  severity: OpsIncidentSeverity;
  title: string;
  detail: string;
  count: number;
};

export type OpsIncidentInput = {
  metaDifference: number;
  metaSyncError: string | null;
  whatsappFailed: number;
  whatsappUnconfirmed: number;
  missingMappings: number;
};

/** Turns bounded aggregate evidence into the central incident list. Silence is
 * not treated as an error: an item appears only when a discrepancy, failure,
 * unconfirmed send, or missing mapping is actually observed. */
export function buildOpsIncidents(input: OpsIncidentInput): OpsIncident[] {
  const incidents: OpsIncident[] = [];

  if (input.metaSyncError) {
    incidents.push({
      id: 'meta-sync-error',
      category: 'meta',
      severity: 'critical',
      title: 'Sincronización de Meta Ads fallida',
      detail: input.metaSyncError,
      count: 1,
    });
  }

  if (input.metaDifference !== 0) {
    incidents.push({
      id: 'meta-lead-discrepancy',
      category: 'meta',
      severity: 'warning',
      title: 'Diferencia entre Meta y REKREOS',
      detail: `Diferencia observada de ${input.metaDifference} leads en la reconciliación disponible.`,
      count: Math.abs(input.metaDifference),
    });
  }

  if (input.whatsappFailed > 0) {
    incidents.push({
      id: 'whatsapp-failed',
      category: 'whatsapp',
      severity: 'critical',
      title: 'WhatsApp fallido',
      detail: `${input.whatsappFailed} lead(s) tienen un envío de WhatsApp marcado como fallido.`,
      count: input.whatsappFailed,
    });
  }

  if (input.whatsappUnconfirmed > 0) {
    incidents.push({
      id: 'whatsapp-unconfirmed',
      category: 'whatsapp',
      severity: 'warning',
      title: 'WhatsApp sin confirmación',
      detail: `${input.whatsappUnconfirmed} lead(s) no tienen envío, entrega o respuesta de WhatsApp confirmada.`,
      count: input.whatsappUnconfirmed,
    });
  }

  if (input.missingMappings > 0) {
    incidents.push({
      id: 'missing-mappings',
      category: 'mapping',
      severity: 'warning',
      title: 'Mappings pendientes',
      detail: `${input.missingMappings} mapping(s) de origen o integración necesitan completarse.`,
      count: input.missingMappings,
    });
  }

  return incidents;
}
