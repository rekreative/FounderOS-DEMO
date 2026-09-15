import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'app/(internal)/leads/page.tsx'), 'utf8');

describe('Leads responsive layout contract', () => {
  test('uses cards on mobile and reserves the wide table for desktop', () => {
    expect(source).toContain('function LeadMobileCard');
    expect(source).toContain('className="grid gap-3 md:hidden"');
    expect(source).toContain('className="hidden md:block"');
  });

  test('shows every table field inside each mobile card', () => {
    for (const label of ['Cliente', 'Etapa', 'Intención IA', 'Origen', 'Campaña', 'Última actividad', 'Contacto']) {
      expect(source).toContain(`>${label}<`);
    }
  });

  test('keeps mobile lead text and filters within the viewport', () => {
    expect(source).toContain('break-all');
    expect(source).toContain('break-words');
    expect(source).toContain('w-full min-w-0');
    expect(source).toContain('grid-cols-2');
  });

  test('shows saved manual-note text and keeps note taking inside the lead workflow', () => {
    expect(source).toContain("event.type === 'manual_note'");
    expect(source).toContain('{event.summary}');
    expect(source).toContain('Notas de {leads.find((lead) => lead.id === noteLeadId)?.name');
    expect(source).toContain('Escribe aquí mientras hablas con el lead...');
    expect(source).toContain(".filter((event) => event.type === 'manual_note')");
  });
});
