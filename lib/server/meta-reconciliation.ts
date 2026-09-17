import { query } from './db';
import { getLatestSyncRunByOwnerScope, getMetaMetricCoverage, type MetaMetricCoverage, type MetaSyncRun } from './meta-repo';
import type { ResolvedResultsPeriod } from './results-time';

/**
 * An honest reconciliation between the campaign totals reported by Meta and
 * the leads that actually reached REKREOS.  This deliberately does not try
 * to force the two counts to match: lead tests and deliveries without a
 * campaign identifier remain visible as their own diagnostic signal.
 */
export type MetaLeadReconciliationCampaign = {
  metaAdAccountId: string | null;
  metaCampaignId: string;
  campaignName: string;
  metaLeads: number;
  rekreosLeads: number;
  /** Meta leads minus leads received by REKREOS for the same campaign. */
  difference: number;
  whatsappSent: number;
  whatsappFailed: number;
  whatsappUnconfirmed: number;
};

export type MetaLeadReconciliation = {
  metaLeads: number;
  rekreosLeads: number;
  difference: number;
  /** Meta-originated records which cannot be matched to any campaign. */
  unattributedRekreosLeads: number;
  /** Campaign-tagged CRM records for which the selected Meta window has no campaign row. */
  crmLeadsWithoutMetaMetric: number;
  whatsappSent: number;
  whatsappFailed: number;
  whatsappUnconfirmed: number;
  campaigns: MetaLeadReconciliationCampaign[];
  coverage: MetaMetricCoverage | null;
  lastSync: MetaSyncRun | null;
};

type CampaignRow = {
  meta_ad_account_id: string | null;
  meta_campaign_id: string;
  campaign_name: string;
  meta_leads: string;
  rekreos_leads: string;
  whatsapp_sent: string;
  whatsapp_failed: string;
  whatsapp_unconfirmed: string;
};

type DiagnosticRow = {
  unattributed_rekreos_leads: string;
  crm_leads_without_meta_metric: string;
};

/** Internal REKREATIVE only for V1. Client dashboards will receive their
 * own explicitly authorized reconciliation surface with client access. */
export async function getInternalMetaLeadReconciliation(period: ResolvedResultsPeriod): Promise<MetaLeadReconciliation> {
  const metricConditions = ["account.owner_scope = 'internal'"];
  const leadConditions = ["l.scope = 'internal'", "l.ingestion_source = 'meta_lead_ads'"];
  const params: unknown[] = [];

  if (period.start) {
    params.push(period.start);
    metricConditions.push(`m.date >= $${params.length}::date`);
  }
  if (period.end) {
    params.push(period.end);
    metricConditions.push(`m.date <= $${params.length}::date`);
  }
  if (period.queryStart) {
    params.push(period.queryStart);
    leadConditions.push(`l.created_at >= $${params.length}`);
  }
  if (period.queryEndExclusive) {
    params.push(period.queryEndExclusive);
    leadConditions.push(`l.created_at < $${params.length}`);
  }

  const metricsWhere = metricConditions.join(' AND ');
  const leadsWhere = leadConditions.join(' AND ');
  const campaignResult = await query<CampaignRow>(
    `WITH selected_campaigns AS (
       SELECT
         m.meta_ad_account_id,
         m.meta_campaign_id,
         (array_agg(m.campaign_name ORDER BY m.date DESC))[1] AS campaign_name,
         SUM(m.leads) AS meta_leads
       FROM meta_campaign_daily_metrics m
       JOIN client_meta_accounts account ON account.id = m.meta_account_id
       WHERE ${metricsWhere}
       GROUP BY m.meta_ad_account_id, m.meta_campaign_id
     ), crm_leads AS (
       SELECT
         l.id,
         l.meta_campaign_id,
         COALESCE(wa.type, 'not_sent') AS whatsapp_state
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT e.type
         FROM lead_events e
         WHERE e.lead_id = l.id
           AND e.type IN ('whatsapp_sent', 'whatsapp_delivered', 'whatsapp_failed', 'lead_replied')
         ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
         LIMIT 1
       ) wa ON true
       WHERE ${leadsWhere}
         AND l.meta_campaign_id IS NOT NULL
     )
     SELECT
       c.meta_ad_account_id,
       c.meta_campaign_id,
       c.campaign_name,
       c.meta_leads,
       COUNT(l.id) AS rekreos_leads,
       COUNT(*) FILTER (WHERE l.whatsapp_state IN ('whatsapp_sent', 'whatsapp_delivered', 'lead_replied')) AS whatsapp_sent,
       COUNT(*) FILTER (WHERE l.whatsapp_state = 'whatsapp_failed') AS whatsapp_failed,
       COUNT(*) FILTER (WHERE l.id IS NOT NULL AND l.whatsapp_state NOT IN ('whatsapp_sent', 'whatsapp_delivered', 'lead_replied', 'whatsapp_failed')) AS whatsapp_unconfirmed
     FROM selected_campaigns c
     LEFT JOIN crm_leads l ON l.meta_campaign_id = c.meta_campaign_id
     GROUP BY c.meta_ad_account_id, c.meta_campaign_id, c.campaign_name, c.meta_leads
     ORDER BY c.meta_leads DESC, c.meta_campaign_id`,
    params,
  );

  const diagnosticResult = await query<DiagnosticRow>(
    `WITH selected_campaigns AS (
       SELECT DISTINCT m.meta_campaign_id
       FROM meta_campaign_daily_metrics m
       JOIN client_meta_accounts account ON account.id = m.meta_account_id
       WHERE ${metricsWhere}
     )
     SELECT
       COUNT(*) FILTER (WHERE l.meta_campaign_id IS NULL) AS unattributed_rekreos_leads,
       COUNT(*) FILTER (WHERE l.meta_campaign_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM selected_campaigns c WHERE c.meta_campaign_id = l.meta_campaign_id
       )) AS crm_leads_without_meta_metric
     FROM leads l
     WHERE ${leadsWhere}`,
    params,
  );

  const campaigns = campaignResult.rows.map((row) => {
    const metaLeads = Number(row.meta_leads);
    const rekreosLeads = Number(row.rekreos_leads);
    return {
      metaAdAccountId: row.meta_ad_account_id,
      metaCampaignId: row.meta_campaign_id,
      campaignName: row.campaign_name,
      metaLeads,
      rekreosLeads,
      difference: metaLeads - rekreosLeads,
      whatsappSent: Number(row.whatsapp_sent),
      whatsappFailed: Number(row.whatsapp_failed),
      whatsappUnconfirmed: Number(row.whatsapp_unconfirmed),
    };
  });
  const diagnostics = diagnosticResult.rows[0];
  const [coverage, lastSync] = await Promise.all([
    getMetaMetricCoverage({ ownerScope: 'internal', dateFrom: period.start ?? undefined, dateTo: period.end ?? undefined }),
    getLatestSyncRunByOwnerScope('internal'),
  ]);

  return {
    metaLeads: campaigns.reduce((total, row) => total + row.metaLeads, 0),
    rekreosLeads: campaigns.reduce((total, row) => total + row.rekreosLeads, 0),
    difference: campaigns.reduce((total, row) => total + row.difference, 0),
    unattributedRekreosLeads: Number(diagnostics?.unattributed_rekreos_leads ?? 0),
    crmLeadsWithoutMetaMetric: Number(diagnostics?.crm_leads_without_meta_metric ?? 0),
    whatsappSent: campaigns.reduce((total, row) => total + row.whatsappSent, 0),
    whatsappFailed: campaigns.reduce((total, row) => total + row.whatsappFailed, 0),
    whatsappUnconfirmed: campaigns.reduce((total, row) => total + row.whatsappUnconfirmed, 0),
    campaigns,
    coverage,
    lastSync,
  };
}
