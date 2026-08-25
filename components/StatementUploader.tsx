'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';

/** Phase-2 statement uploader: posts a bank/CC CSV to the ingestion route, then
    refreshes so the expenses-by-category section reflects the real parsed spend. */
export function StatementUploader() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(`Analizando ${file.name}…`);
    // CSV → transaction ledger (categorized expenses); PDF → bank statement
    // summary (per-business income/net).
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const genericError = 'Error al subir el archivo';
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(isPdf ? '/api/finances/bank-statement' : '/api/finances/statements', {
        method: 'POST',
        body,
      });

      // Never assume the body is JSON — read as text and parse defensively.
      // A server-side failure can still come back empty or non-JSON (e.g. an
      // upstream proxy error page); calling response.json() directly on that
      // throws "Unexpected end of JSON input" straight into the catch below
      // and would surface that raw browser message to the operator instead
      // of a stable, useful one.
      const raw = await res.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }
      const serverError =
        data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
          ? (data as { error: string }).error
          : null;

      if (!res.ok) {
        setStatus(`✗ ${serverError ?? genericError}`);
      } else if (!data || typeof data !== 'object') {
        setStatus(`✗ ${genericError}`);
      } else if (isPdf) {
        const summary = (data as { summary?: { business: string; month: string; creditsCents: number } }).summary;
        if (!summary) {
          setStatus(`✗ ${genericError}`);
        } else {
          setStatus(
            `✓ ${summary.business} ${summary.month}: ${(summary.creditsCents / 100).toLocaleString('es-ES', { maximumFractionDigits: 0 })} € recibidos`,
          );
          router.refresh();
        }
      } else {
        const { inserted, parsed } = data as { inserted?: number; parsed?: number };
        if (inserted == null || parsed == null) {
          setStatus(`✗ ${genericError}`);
        } else {
          setStatus(`✓ ${inserted} nuevas de ${parsed} filas analizadas`);
          router.refresh();
        }
      }
    } catch {
      // Network/fetch-level failure only — response.json() is never called
      // blindly above, so this never carries a raw parsing error message.
      setStatus(`✗ ${genericError}`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg-t border border-dashed border-os-border-strong bg-os-surface px-5 py-8 text-center">
      <Upload className="h-5 w-5 text-os-dim" strokeWidth={1.6} />
      <div className="text-[13px] font-semibold text-os-muted">Importar extracto</div>
      <p className="max-w-[260px] font-mono text-[10.5px] leading-relaxed text-os-dim">
        Sube un <strong>CSV</strong> de tarjeta de crédito (gasto categorizado) o un extracto bancario en{' '}
        <strong>PDF</strong> (ingresos por negocio). Se guarda localmente (excluido de git), nunca se sube al repositorio.
      </p>
      <label className="cursor-pointer rounded-sm-t border border-os-border-strong px-3 py-1.5 font-mono text-[11px] text-os-accent transition-colors hover:bg-os-surface2">
        {busy ? 'Procesando…' : 'Elegir CSV o PDF'}
        <input type="file" accept=".csv,text/csv,.pdf,application/pdf" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      {status && <div className="mt-1 max-w-[260px] font-mono text-[10px] text-os-dim">{status}</div>}
    </div>
  );
}
