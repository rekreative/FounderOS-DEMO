import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPortalEventSummary } from '../lib/client-portal-presentation';

const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');

describe('client portal visual usability', () => {
  it('keeps lead cards within the mobile grid and loads a manageable batch', () => {
    const manager = read('components', 'ClientPortalLeadManager.tsx');
    expect(manager).toMatch(/grid-cols-1/);
    expect(manager).toMatch(/min-w-0 w-full/);
    expect(manager).toMatch(/visibleLeads/);
    expect(manager).toMatch(/Mostrar 24 más/);
    expect(manager).toMatch(/sticky top-0/);
  });

  it('distinguishes API acceptance from delivery and historical appointments from current stage', () => {
    const manager = read('components', 'ClientPortalLeadManager.tsx');
    const page = read('app', '(client)', 'portal', '[clientId]', 'page.tsx');
    expect(manager).toMatch(/Aceptado por la API/);
    expect(manager).toMatch(/Etapa actual/);
    expect(page).toMatch(/Citas registradas/);
    expect(page).toMatch(/Histórico/);
  });

  it('groups lead actions and uses Spanish history labels', () => {
    const manager = read('components', 'ClientPortalLeadManager.tsx');
    expect(manager).toMatch(/Primer contacto/);
    expect(manager).toMatch(/Avance comercial/);
    expect(manager).toMatch(/Cierre/);
    expect(manager).toMatch(/Historial/);
    expect(manager).toMatch(/formatPortalEventSummary\(event\)/);
  });
});

describe('client portal event presentation', () => {
  it('translates only standard generated summaries', () => {
    expect(formatPortalEventSummary({ type: 'stage_changed', summary: 'Stage changed to Contactado', details: { to: 'contacted' } })).toBe('Etapa actualizada a Contactado');
    expect(formatPortalEventSummary({ type: 'lead_received', summary: 'Ana was received via automated ingestion' })).toBe('Ana entró mediante la automatización');
    expect(formatPortalEventSummary({ type: 'whatsapp_sent', summary: 'WhatsApp message sent' })).toBe('WhatsApp enviado');
    expect(formatPortalEventSummary({ type: 'appointment_booked', summary: 'Appointment booked' })).toBe('Cita registrada');
  });

  it('preserves manual notes and unknown external details verbatim', () => {
    expect(formatPortalEventSummary({ type: 'manual_note', summary: 'Call on Friday' })).toBe('Call on Friday');
    expect(formatPortalEventSummary({ type: 'whatsapp_failed', summary: 'Provider error 131026' })).toBe('Provider error 131026');
  });
});
