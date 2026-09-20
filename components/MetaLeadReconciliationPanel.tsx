'use client';

import { useEffect, useState } from 'react';
import { Badge, type BadgeTone, SectionHead } from '@/components/terminal';
import { getInternalMetaLeadReconciliation, type MetaLeadReconciliation } from '@/lib/api/results';
import type { ResultsPeriodPreset } from '@/lib/api/results';

type Props = {
  preset?: ResultsPeriodPreset;
  start?: string;
  end?: string;
  compact?: boolean;
};

function differenceTone(difference: number): BadgeTone {
  return difference === 0 ? 'ok' : 'warn';
}

function differenceLabel(difference: number): string {
  if (difference === 0) return 'Cuadrado';
  return difference > 0 ? `${difference} por revisar` : `${Math.abs(difference)} extra en CRM`;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: BadgeTone }) {
  return (
    <div className="min-w-0 border border-os-border bg-os-surface2 px-3 py-2.5">
      <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-os-dim">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2"><strong className="font-mono text-[16px] text-os-text">{value}</strong><Badge tone={tone}>{tone === 'err' ? 'Revisar' : 'OK'}</Badge></div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: MetaLeadReconciliation['campaigns'][number] }) {
  return (
    <div className="border-t border-os-border px-3 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="break-words text-[12px] font-semibold text-os-text">{campaign.campaignName}</p><p className="mt-0.5 font-mono text-[8.5px] text-os-dim">ID {campaign.metaCampaignId}</p></div>
        <Badge tone={differenceTone(campaign.difference)}>{differenceLabel(campaign.difference)}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px bg-os-border sm:grid-cols-6">
        {[
          ['Meta', campaign.metaLeads],
          ['REKREOS', campaign.rekreosLeads],
          ['Diferencia', campaign.difference],
          ['WP enviado', campaign.whatsappSent],
          ['WP pendiente', campaign.whatsappUnconfirmed],
          ['Sin trazabilidad', campaign.whatsappHistorical],
        ].map(([label, value]) => (
          <div key={String(label)} className="min-w-0 bg-os-surface2 px-2 py-1.5"><p className="font-mono text-[7.5px] uppercase tracking-wide text-os-dim">{label}</p><p className="mt-0.5 font-mono text-[11px] text-os-text">{value}</p></div>
        ))}
      </div>
      {campaign.whatsappFailed > 0 && <p className="mt-2 font-mono text-[9px] text-os-err">WhatsApp fallido: {campaign.whatsappFailed}</p>}
    </div>
  );
}

export function MetaLeadReconciliationPanel({ preset = 'all', start, end, compact = false }: Props) {
  const [data, setData] = useState<MetaLeadReconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset === 'custom' && (!start || !end)) return;
    let cancelled = false;
    setError(null);
    getInternalMetaLeadReconciliation({ preset, start, end })
      .then((response) => { if (!cancelled) setData(response.reconciliation); })
      .catch(() => { if (!cancelled) setError('No se pudo comprobar la conciliación Meta ↔ REKREOS.'); });
    return () => { cancelled = true; };
  }, [preset, start, end]);

  const headline = data?.difference ?? 0;
  return (
    <section className="border border-os-border bg-os-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><SectionHead label="Conciliación Meta ↔ REKREOS" /><p className="-mt-2 font-mono text-[9px] text-os-dim">Compara campañas Meta con leads realmente recibidos.</p></div>
        {data && <Badge tone={differenceTone(headline)}>{differenceLabel(headline)}</Badge>}
      </div>
      {error ? <p className="mt-3 font-mono text-[10px] text-os-err">{error}</p> : !data ? <p className="mt-3 font-mono text-[10px] text-os-dim">Comprobando datos…</p> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric label="Leads Meta" value={data.metaLeads} />
            <Metric label="Con campaña en REKREOS" value={data.rekreosLeads} />
            <Metric label="Diferencia" value={data.difference} tone={differenceTone(data.difference)} />
            <Metric label="WP fallido" value={data.whatsappFailed} tone={data.whatsappFailed > 0 ? 'err' : 'ok'} />
          </div>
          {(data.unattributedRekreosLeads > 0 || data.crmLeadsWithoutMetaMetric > 0 || data.whatsappUnconfirmed > 0) && (
            <div className="mt-2 border-l-2 border-os-warn bg-os-warn/10 px-3 py-2 font-mono text-[9px] text-os-muted">
              {data.unattributedRekreosLeads > 0 && <span>{data.unattributedRekreosLeads} lead(s) de REKREOS sin campaña atribuida. </span>}
              {data.crmLeadsWithoutMetaMetric > 0 && <span>{data.crmLeadsWithoutMetaMetric} sin métrica Meta en este periodo. </span>}
              {data.whatsappUnconfirmed > 0 && <span>{data.whatsappUnconfirmed} sin confirmación de WhatsApp.</span>}
            </div>
          )}
          {data.whatsappHistorical > 0 && (
            <div className="mt-2 border-l-2 border-os-border-strong bg-os-surface2 px-3 py-2 font-mono text-[9px] text-os-dim">
              {data.whatsappHistorical} lead(s) anterior(es) al inicio de la trazabilidad de WhatsApp; no se consideran incidencias automáticas.
            </div>
          )}
          {!compact && <div className="mt-3 overflow-hidden border border-os-border">{data.campaigns.length === 0 ? <p className="px-3 py-5 text-center font-mono text-[10px] text-os-dim">No hay campañas Meta en el periodo seleccionado.</p> : data.campaigns.map((campaign) => <CampaignRow key={`${campaign.metaAdAccountId ?? 'account'}:${campaign.metaCampaignId}`} campaign={campaign} />)}</div>}
        </>
      )}
    </section>
  );
}
