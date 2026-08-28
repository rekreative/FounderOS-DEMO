import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { parseBankStatementSummary } from '@/lib/bank-statements';
import { openBankStore } from '@/lib/bank';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Extract text from a PDF via the system `pdftotext` (poppler). Tries PATH then
// common Homebrew/usr-local locations; -layout keeps the summary columns aligned.
function pdfToText(buf: Buffer): Promise<string> {
  const candidates = ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext'];
  return new Promise((resolve, reject) => {
    const tryRun = (i: number) => {
      if (i >= candidates.length) return reject(new Error('pdftotext not installed (brew install poppler)'));
      const child = execFile(
        candidates[i],
        ['-layout', '-', '-'],
        { maxBuffer: 25 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return tryRun(i + 1);
          if (err) return reject(err);
          resolve(stdout);
        },
      );
      child.stdin?.end(buf);
    };
    tryRun(0);
  });
}

/** Accept a bank-statement PDF, extract its summary (income/outflow per business
    per month), and upsert it into the bank store. Idempotent by account+month. */
export async function POST(req: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const ctype = req.headers.get('content-type') ?? '';
  let buf: Buffer | null = null;
  try {
    if (ctype.includes('multipart/form-data')) {
      const file = (await req.formData()).get('file');
      if (file && typeof (file as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
        buf = Buffer.from(await (file as File).arrayBuffer());
      }
    } else {
      buf = Buffer.from(await req.arrayBuffer());
    }
  } catch {
    buf = null;
  }
  if (!buf || buf.length === 0) {
    return NextResponse.json({ error: 'expected a PDF upload (file field or PDF body)' }, { status: 400 });
  }

  let text: string;
  try {
    text = await pdfToText(buf);
  } catch (error) {
    // pdftotext's own error can carry local binary paths and command
    // stderr — never forward it raw to the client. Logged server-side by
    // unexpectedError(), same convention as every Backend V1 route.
    return unexpectedError('POST /api/finances/bank-statement (pdftotext)', error);
  }

  const summary = parseBankStatementSummary(text);
  if (!summary) {
    return NextResponse.json({ error: 'not a recognizable bank statement summary' }, { status: 400 });
  }

  // openBankStore()/upsert() can throw for reasons outside the caller's
  // control (e.g. a fresh environment's data/ dir — see lib/bank.ts). Never
  // let that surface as an empty/non-JSON 500 — StatementUploader always
  // calls response.json(), so every path here must return a real JSON body.
  // The user-facing message stays a fixed, static string (never the raw
  // error) — logged server-side first so this failure is no longer silently
  // swallowed.
  try {
    const store = openBankStore();
    try {
      store.upsert(summary);
    } finally {
      store.close();
    }
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[api] POST /api/finances/bank-statement (bank store):', error);
    return NextResponse.json({ error: 'No se pudo procesar el extracto' }, { status: 500 });
  }
}
