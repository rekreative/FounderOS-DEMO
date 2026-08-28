import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Source-contract tests for the correction pass fixing three
 * frontend truth/error-handling issues in the canonical /connections board
 * and the client-workspace Integraciones tab (Connections/Secrets V1). This
 * suite runs under vitest's `node` environment (no jsdom/React Testing
 * Library in this repo — see tests/code-splitting.test.ts /
 * tests/analytics-truth-v1.test.ts for the established pattern), so these
 * assert structural properties of the component source rather than
 * rendering it.
 */

describe('IntegrationConnectionsBoard — manual-records loading/error truth (Issue 3)', () => {
  const board = read('components/IntegrationConnectionsBoard.tsx');

  test('KPI/onboarding/connection-list/catalog content is gated behind the same connectionsError/connectionsLoading ternary that shows the error+retry or loading placeholder — never rendered alongside zero/empty results', () => {
    // The success branch's capture is anchored on the known text immediately
    // after its closing `</>` (the next JSX block, {showForm && (), rather
    // than a bare `<\/>`, which would stop at the FIRST nested fragment
    // close inside (the `moduleScope === 'client' && (<>...</>)` block).
    const gate = board.match(
      /connectionsError \? \(([\s\S]*?)\) : connectionsLoading \? \(([\s\S]*?)\) : \(\s*<>([\s\S]*?)<\/>\s*\)\}\s*\{showForm/,
    );
    expect(gate, 'expected a connectionsError/connectionsLoading/success three-way ternary').not.toBeNull();
    const [, errorBranch, loadingBranch, successBranch] = gate!;

    // Error branch: visible message + a retry control (Issue 3's "minimal retry control").
    expect(errorBranch).toContain('{connectionsError}');
    expect(errorBranch).toMatch(/retryLoadConnections/);
    expect(errorBranch).toContain('Reintentar');

    // Loading branch: an honest placeholder, never the KPI/onboarding/catalog markup.
    expect(loadingBranch).toContain('Cargando conexiones');
    expect(loadingBranch).not.toContain('Configuradas');
    expect(loadingBranch).not.toContain('Principales');

    // Success branch only: KPI tiles, onboarding, and the platform catalog —
    // these must never appear in the error or loading branches above.
    for (const marker of ['Configuradas', 'Onboarding técnico por cliente', 'Principales', 'Explorar por categoría']) {
      expect(successBranch).toContain(marker);
      expect(errorBranch).not.toContain(marker);
      expect(loadingBranch).not.toContain(marker);
    }
  });

  test('"Estado real de REKREATIVE" (the independent GET /api/ops/status section) is not inside the connectionsError/connectionsLoading gate', () => {
    const opsSectionIndex = board.indexOf('Estado real de REKREATIVE');
    const gateStartIndex = board.indexOf('connectionsError ? (');
    expect(opsSectionIndex).toBeGreaterThan(-1);
    expect(gateStartIndex).toBeGreaterThan(-1);
    expect(opsSectionIndex).toBeLessThan(gateStartIndex); // renders before, and independently of, the gate
    expect(board).toMatch(/opsError \? \(/); // keeps its own separate error branch
  });

  test('"Ver archivadas" and "+ Añadir conexión" are disabled while the initial load is pending or failed', () => {
    const disabledCount = (board.match(/disabled=\{connectionsLoading \|\| Boolean\(connectionsError\)\}/g) ?? []).length;
    expect(disabledCount).toBe(2);
  });

  test('retryLoadConnections re-arms connectionsLoading before refetching, so a retry shows the loading placeholder again', () => {
    expect(board).toMatch(/const retryLoadConnections = \(\) => \{\s*setConnectionsLoading\(true\);\s*void refreshConnections\(\);/);
  });
});

describe('IntegrationConnectionsBoard — mutation error handling (Issue 1)', () => {
  const board = read('components/IntegrationConnectionsBoard.tsx');

  test('runConnectionAction clears the previous error, only refreshes on success, and always clears pending in finally', () => {
    const fn = board.match(/const runConnectionAction = async[\s\S]*?\n  \};/);
    expect(fn, 'expected a runConnectionAction definition').not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/setActionError\(null\)/);
    expect(body).toMatch(/setPendingConnectionId\(id\)/);
    expect(body).toMatch(/try \{\s*await mutate\(\);\s*await refreshConnections\(\);/);
    expect(body).toMatch(/catch \(error\) \{\s*setActionError\(/);
    expect(body).toMatch(/finally \{\s*setPendingConnectionId\(null\);/);
  });

  test('verify/fail/reset/archive all route through runConnectionAction — no bare unhandled await', () => {
    expect(board).toMatch(/const handleMarkVerified = \(id: string\) => runConnectionAction\(id, \(\) => markIntegrationConnectionVerified\(id\)\)/);
    expect(board).toMatch(/const handleMarkFailed = \(id: string\) => runConnectionAction\(id, \(\) => markIntegrationConnectionFailed\(id\)\)/);
    expect(board).toMatch(/const handleReset = \(id: string\) => runConnectionAction\(id, \(\) => resetIntegrationConnectionVerification\(id\)\)/);
    expect(board).toMatch(/const handleArchive = \(id: string\) => runConnectionAction\(id, \(\) => archiveIntegrationConnection\(id\)\)/);
  });

  test('the manual-connections section renders a visible actionError banner (no toast library)', () => {
    expect(board).toMatch(/\{actionError && \(\s*<div className="mb-4 border border-os-err\/40 bg-os-err\/10[^"]*">\{actionError\}<\/div>/);
    expect(board).not.toMatch(/react-hot-toast|react-toastify|sonner/);
  });

  test('handleRestore has its own try/catch writing to restoreError (never actionError), and always refreshes both lists only after success', () => {
    const fn = board.match(/const handleRestore = async[\s\S]*?\n  \};/);
    expect(fn, 'expected a handleRestore definition').not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/setRestoreError\(null\)/);
    expect(body).toMatch(/try \{\s*await restoreIntegrationConnection\(id\);\s*await refreshConnections\(\);\s*await refreshArchivedConnections\(\);/);
    expect(body).toMatch(/catch \(error\) \{\s*setRestoreError\(/);
    expect(body).toMatch(/finally \{\s*setPendingConnectionId\(null\);/);
    expect(body).not.toMatch(/setActionError/);
  });

  test('the archived-connections modal renders restoreError above its list, distinct from the load-failure archivedError branch', () => {
    const modal = board.slice(board.indexOf('Conexiones archivadas — the minimal'));
    expect(modal).toMatch(/\{restoreError && \(/);
    expect(modal).toMatch(/archivedError \? \(/);
  });
});

describe('IntegrationConnectionsBoard / ConnectionCard — duplicate-mutation prevention (Issue 2)', () => {
  const board = read('components/IntegrationConnectionsBoard.tsx');

  test('a single pendingConnectionId state exists — no per-record Set, no global state library', () => {
    expect(board).toMatch(/const \[pendingConnectionId, setPendingConnectionId\] = useState<string \| null>\(null\)/);
    expect(board).not.toMatch(/zustand|redux|jotai|recoil/i);
  });

  test('ConnectionCard takes a `pending` prop and disables every mutation control (edit/verify/fail/reset/archive) with it — never the detail toggle', () => {
    const disabledPendingCount = (board.match(/disabled=\{pending\}/g) ?? []).length;
    // marcar verificada, marcar incidencia, restablecer, editar, archivar
    expect(disabledPendingCount).toBe(5);
    expect(board).toMatch(/pending && \(\s*<span[^>]*role="status">\s*Procesando…/);
    // the detail toggle button must not gain a `disabled` prop from this pass
    const toggleButton = board.match(/<button type="button" onClick=\{onToggle\}[^>]*>/);
    expect(toggleButton).not.toBeNull();
    expect(toggleButton![0]).not.toContain('disabled');
  });

  test('both ConnectionCard call sites pass pending={pendingConnectionId === connection.id}', () => {
    const count = (board.match(/pending=\{pendingConnectionId === connection\.id\}/g) ?? []).length;
    expect(count).toBe(2);
  });

  test('the archived modal disables its own Restaurar button per-row and shows "Procesando…" while restoring', () => {
    const modal = board.slice(board.indexOf('Conexiones archivadas — the minimal'));
    expect(modal).toMatch(/const restoring = pendingConnectionId === connection\.id/);
    expect(modal).toMatch(/disabled=\{restoring\}/);
    expect(modal).toMatch(/\{restoring \? 'Procesando…' : 'Restaurar'\}/);
  });

  test('create/edit keeps its existing formSubmitting behavior, untouched by this pass', () => {
    expect(board).toMatch(/const \[formSubmitting, setFormSubmitting\] = useState\(false\)/);
    expect(board).toMatch(/disabled=\{formSubmitting\}/);
  });
});

describe('client workspace Integraciones tab — loading/error distinct from empty (Issue 3)', () => {
  const page = read('app/(internal)/clients/[clientId]/page.tsx');
  const panel = read('components/ClientIntegrationsPanel.tsx');

  test('the page tracks module-specific connectionsLoading/connectionsError, separate from the page-wide loadError', () => {
    expect(page).toMatch(/const \[connectionsLoading, setConnectionsLoading\] = useState\(true\)/);
    expect(page).toMatch(/const \[connectionsError, setConnectionsError\] = useState<string \| null>\(null\)/);
  });

  test('the integration-connections fetch sets loading/error state instead of only console.error, and preserves the cancellation guard', () => {
    const fetchBlock = page.match(/getIntegrationConnections\(\)[\s\S]*?\.finally\(\(\) => \{[\s\S]*?\}\);/);
    expect(fetchBlock, 'expected the getIntegrationConnections().then/.catch/.finally chain').not.toBeNull();
    const body = fetchBlock![0];
    expect(body).toMatch(/if \(cancelled\) return;/);
    expect(body).toMatch(/setConnectionsError\(/);
    expect(body).toMatch(/if \(!cancelled\) setConnectionsLoading\(false\);/);
    // console.error alone is no longer the sole feedback mechanism — it may
    // remain alongside the state write, but a state write must exist too.
    expect(body).toContain('console.error');
  });

  test('ClientIntegrationsPanel receives loading/error props from the page', () => {
    expect(page).toMatch(/<ClientIntegrationsPanel[\s\S]*?loading=\{connectionsLoading\}[\s\S]*?error=\{connectionsError\}[\s\S]*?\/>/);
  });

  test('ClientIntegrationsPanel checks error and loading BEFORE the requirements-empty check — a load-in-progress or failed client is never presented as "no plan defined"', () => {
    const ternary = panel.match(/error \? \(([\s\S]*?)\) : loading \? \(([\s\S]*?)\) : requirements\.length === 0 \? \(([\s\S]*?)\) : \(/);
    expect(ternary, 'expected an error / loading / requirements-empty / loaded ternary, in that order').not.toBeNull();
    const [, errorBranch, loadingBranch, emptyBranch] = ternary!;
    expect(errorBranch).toContain('{error}');
    expect(loadingBranch).toContain('Cargando integraciones');
    expect(emptyBranch).toContain('Sin plan de onboarding definido');
    // the loading/error branches must not themselves claim "no plan defined"
    expect(errorBranch).not.toContain('Sin plan de onboarding definido');
    expect(loadingBranch).not.toContain('Sin plan de onboarding definido');
  });

  test('the fetch still loads every active connection (not scoped to clientId) — onboarding needs this client plus every internal shared connection', () => {
    expect(page).toMatch(/getIntegrationConnections\(\)\s*\n\s*\.then/);
    expect(page).not.toMatch(/getIntegrationConnections\(\{\s*clientId/);
  });
});
