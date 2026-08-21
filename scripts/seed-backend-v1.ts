import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { getSeedClients } from '../lib/clients';
import { readEnvLocal } from '../lib/creds';
import { closePool, withTransaction } from '../lib/server/db';

/**
 * Backend V1 development seed: Clients + Leads + LeadEvents into the real
 * PostgreSQL database. Reuses the exact approved V1 demo dataset (the same
 * 3 seed clients from lib/clients.ts's SEED_CLIENTS, the same 7 leads and
 * 21 events that used to live in lib/leads.ts's seedDemoLeads()/
 * seedLeadEvents() before the localStorage persistence functions were
 * removed) — same ids, same names, same scope/clientId pairs. Nothing here
 * invents new demo content.
 *
 * Idempotent: every INSERT is `ON CONFLICT (id) DO NOTHING` — re-running
 * never duplicates a row and never overwrites one an operator has since
 * edited through the UI (a re-seed is a no-op for anything already there).
 * Never deletes anything. Safe to run any number of times.
 */

// getPool() (used by withTransaction) reads DATABASE_URL lazily, only once
// actually called below — so setting it here, before run() does anything,
// is sufficient even though the import above is a static/hoisted binding.
if (!process.env.DATABASE_URL) {
  const url = readEnvLocal().DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
}

type SeedLead = {
  id: string;
  scope: 'internal' | 'client';
  clientId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string;
  campaign: string | null;
  adCreative: string | null;
  form: string | null;
  stage: string;
  createdAt: string;
  lastActivityAt: string;
  aiAnalysis: {
    summary: string;
    intent: string;
    priority: string;
    qualification: Record<string, string>;
    analyzedAt: string;
  } | null;
  qualificationAnswers: Record<string, string> | null;
  appointmentDate: string | null;
  conversionValue: number | null;
};

type SeedEvent = {
  id: string;
  leadId: string;
  type: string;
  source: string;
  occurredAt: string;
  summary: string;
  details: Record<string, unknown> | null;
};

function buildSeedLeads(): SeedLead[] {
  const now = new Date();
  const daysAgo = (days: number, hours = 0): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  };

  return [
    {
      id: 'lead-demo-1',
      scope: 'client',
      clientId: 'client-acme',
      name: 'Maya Chen',
      email: 'maya.chen@example.com',
      phone: '+1 415 555 1010',
      whatsapp: '+1 415 555 1010',
      source: 'Meta Ads',
      campaign: 'Spring Retargeting',
      adCreative: 'Consulting funnel V2',
      form: 'Website instant form',
      stage: 'appointment',
      createdAt: daysAgo(3),
      lastActivityAt: daysAgo(0, 12),
      aiAnalysis: {
        summary: 'Warm fit for growth consulting. Asked for pricing and wants a call within 48 hours.',
        intent: 'warm',
        priority: 'high',
        qualification: { pain: 'Not enough qualified leads', urgency: 'High' },
        analyzedAt: daysAgo(2, 20),
      },
      qualificationAnswers: { challenge: 'Need more qualified pipeline', budget: 'Open to a scoped package' },
      appointmentDate: daysAgo(0, 12),
      conversionValue: null,
    },
    {
      id: 'lead-demo-2',
      scope: 'client',
      clientId: 'client-lumen',
      name: 'Nora Singh',
      email: 'nora@lumen.example.com',
      phone: '+1 415 555 2020',
      whatsapp: '+1 415 555 2020',
      source: 'Organic',
      campaign: 'Brand discovery',
      adCreative: 'Organic profile visit',
      form: 'Landing page CTA',
      stage: 'qualified',
      createdAt: daysAgo(6),
      lastActivityAt: daysAgo(5, 8),
      aiAnalysis: {
        summary: 'Strong fit for a small creative retainer with clear moodboard and launch goals.',
        intent: 'hot',
        priority: 'high',
        qualification: { fit: 'Strong', urgency: 'Medium' },
        analyzedAt: daysAgo(5, 20),
      },
      qualificationAnswers: { budget: 'Medium', timeline: 'Within 2 weeks' },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-demo-3',
      scope: 'client',
      clientId: 'client-northwind',
      name: 'Adrian Brooks',
      email: 'adrian@northwind.example.com',
      phone: '+1 415 555 3030',
      whatsapp: '+1 415 555 3030',
      source: 'Paid Search',
      campaign: 'Retainer Funnel',
      adCreative: 'Landing page',
      form: 'Lead capture form',
      stage: 'contacted',
      createdAt: daysAgo(10),
      lastActivityAt: daysAgo(8, 10),
      aiAnalysis: {
        summary: 'Potential fit but needs an additional qualification call before committing.',
        intent: 'warm',
        priority: 'medium',
        qualification: { salesCycle: '6-8 weeks', needs: 'Multi-channel growth' },
        analyzedAt: daysAgo(9, 15),
      },
      qualificationAnswers: { goal: 'Scale inbound pipeline' },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-demo-4',
      scope: 'client',
      clientId: 'client-acme',
      name: 'Elliot Price',
      email: 'elliot@acme.example.com',
      phone: '+1 415 555 4040',
      whatsapp: '+1 415 555 4040',
      source: 'Referral',
      campaign: 'Partner referral',
      adCreative: null,
      form: 'Manual intake',
      stage: 'converted',
      createdAt: daysAgo(15),
      lastActivityAt: daysAgo(13, 4),
      aiAnalysis: {
        summary: 'Strong commercial fit and ready to buy with a clear budget.',
        intent: 'hot',
        priority: 'high',
        qualification: { readiness: 'Very high', fit: 'Strong' },
        analyzedAt: daysAgo(14, 13),
      },
      qualificationAnswers: { budget: 'High', active: 'Yes' },
      appointmentDate: daysAgo(13, 4),
      conversionValue: 4200,
    },
    {
      id: 'lead-demo-5',
      scope: 'client',
      clientId: 'client-lumen',
      name: 'Harper Ross',
      email: 'harper@lumen.example.com',
      phone: '+1 415 555 5050',
      whatsapp: '+1 415 555 5050',
      source: 'Meta Ads',
      campaign: 'Video Ad',
      adCreative: 'Launch offer reel',
      form: 'Instant form',
      stage: 'new',
      createdAt: daysAgo(21),
      lastActivityAt: daysAgo(18, 10),
      aiAnalysis: null,
      qualificationAnswers: null,
      appointmentDate: null,
      conversionValue: null,
    },
    // REKREATIVE's own internal acquisition — prospects for REKREATIVE
    // itself (psychology centers/professionals interested in REKREATIVE's
    // marketing services), never a client. scope: 'internal', clientId: null.
    {
      id: 'lead-internal-1',
      scope: 'internal',
      clientId: null,
      name: 'Dra. Carla Méndez',
      email: 'carla.mendez@centropsique.example.com',
      phone: '+34 611 222 333',
      whatsapp: '+34 611 222 333',
      source: 'Meta Ads',
      campaign: 'REKREATIVE — Captación Centros de Psicología',
      adCreative: 'Anuncio de captación para consultas de psicología',
      form: 'Formulario instantáneo REKREATIVE',
      stage: 'qualified',
      createdAt: daysAgo(7),
      lastActivityAt: daysAgo(1, 4),
      aiAnalysis: {
        summary: 'Dirige un centro de psicología con 4 profesionales y busca más pacientes de terapia individual.',
        intent: 'warm',
        priority: 'high',
        qualification: { pain: 'Pocas consultas nuevas al mes', urgency: 'Media' },
        analyzedAt: daysAgo(6, 20),
      },
      qualificationAnswers: { servicio: 'Terapia individual y de pareja', presupuesto: 'Abierta a un paquete mensual' },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-internal-2',
      scope: 'internal',
      clientId: null,
      name: 'Javier Roldán',
      email: 'javier@institutobienestar.example.com',
      phone: '+34 622 444 555',
      whatsapp: null,
      source: 'Meta Ads',
      campaign: 'REKREATIVE — Captación Centros de Psicología',
      adCreative: 'Anuncio de captación para consultas de psicología',
      form: 'Formulario instantáneo REKREATIVE',
      stage: 'new',
      createdAt: daysAgo(2),
      lastActivityAt: daysAgo(2),
      aiAnalysis: null,
      qualificationAnswers: null,
      appointmentDate: null,
      conversionValue: null,
    },
  ];
}

function buildSeedEvents(): SeedEvent[] {
  const now = new Date();
  const offset = (days: number, hours: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  };

  return [
    { id: 'evt-demo-1', leadId: 'lead-demo-1', type: 'lead_received', source: 'meta', occurredAt: offset(3, 2), summary: 'Meta instant form submitted', details: { campaign: 'Spring Retargeting' } },
    { id: 'evt-demo-2', leadId: 'lead-demo-1', type: 'ai_analyzed', source: 'openai', occurredAt: offset(3, 1), summary: 'AI analyzed the lead and marked it warm', details: { intent: 'warm', priority: 'high' } },
    { id: 'evt-demo-3', leadId: 'lead-demo-1', type: 'whatsapp_sent', source: 'whatsapp', occurredAt: offset(2, 6), summary: 'WhatsApp template sent', details: { template: 'lead-responder' } },
    { id: 'evt-demo-4', leadId: 'lead-demo-1', type: 'lead_replied', source: 'whatsapp', occurredAt: offset(1, 3), summary: 'Lead replied asking for pricing', details: null },
    { id: 'evt-demo-5', leadId: 'lead-demo-1', type: 'appointment_booked', source: 'crm', occurredAt: offset(0, 12), summary: 'Discovery call booked', details: { appointmentDate: offset(0, 12) } },
    { id: 'evt-demo-6', leadId: 'lead-demo-2', type: 'lead_received', source: 'meta', occurredAt: offset(6, 2), summary: 'Meta lead submitted via a lead form', details: { campaign: 'New Client Offer' } },
    { id: 'evt-demo-7', leadId: 'lead-demo-2', type: 'ai_analyzed', source: 'openai', occurredAt: offset(5, 20), summary: 'AI analysis flagged a likely fit', details: { intent: 'hot', priority: 'high' } },
    { id: 'evt-demo-8', leadId: 'lead-demo-2', type: 'commercial_contacted', source: 'manual', occurredAt: offset(5, 8), summary: 'Commercial outreach sent by team', details: null },
    { id: 'evt-demo-9', leadId: 'lead-demo-3', type: 'lead_received', source: 'meta', occurredAt: offset(10, 1), summary: 'Lead came in from an ad click', details: { campaign: 'Retainer Funnel' } },
    { id: 'evt-demo-10', leadId: 'lead-demo-3', type: 'whatsapp_sent', source: 'whatsapp', occurredAt: offset(9, 15), summary: 'WhatsApp value proposition sent', details: null },
    { id: 'evt-demo-11', leadId: 'lead-demo-3', type: 'stage_changed', source: 'system', occurredAt: offset(8, 10), summary: 'Lead moved to qualified', details: { from: 'contacted', to: 'qualified' } },
    { id: 'evt-demo-12', leadId: 'lead-demo-4', type: 'lead_received', source: 'meta', occurredAt: offset(15, 2), summary: 'Lead form submitted after homepage CTA', details: { campaign: 'Offer page' } },
    { id: 'evt-demo-13', leadId: 'lead-demo-4', type: 'ai_analyzed', source: 'openai', occurredAt: offset(14, 13), summary: 'AI found strong service fit', details: { intent: 'warm', priority: 'medium' } },
    { id: 'evt-demo-14', leadId: 'lead-demo-4', type: 'appointment_completed', source: 'crm', occurredAt: offset(13, 4), summary: 'Consultation completed', details: null },
    { id: 'evt-demo-15', leadId: 'lead-demo-5', type: 'lead_received', source: 'meta', occurredAt: offset(21, 3), summary: 'Lead came in from a paid campaign', details: { campaign: 'Video Ad' } },
    { id: 'evt-demo-16', leadId: 'lead-demo-5', type: 'converted', source: 'system', occurredAt: offset(18, 10), summary: 'Lead converted to paying client', details: { value: 4200 } },
    // REKREATIVE's own internal acquisition — scope: 'internal', never a client.
    { id: 'evt-internal-1', leadId: 'lead-internal-1', type: 'lead_received', source: 'meta', occurredAt: offset(7, 3), summary: 'Meta instant form submitted', details: { campaign: 'REKREATIVE — Captación Centros de Psicología' } },
    { id: 'evt-internal-2', leadId: 'lead-internal-1', type: 'ai_analyzed', source: 'openai', occurredAt: offset(6, 20), summary: 'AI analyzed the lead and marked it warm', details: { intent: 'warm', priority: 'high' } },
    { id: 'evt-internal-3', leadId: 'lead-internal-1', type: 'commercial_contacted', source: 'manual', occurredAt: offset(6, 4), summary: 'Commercial outreach sent by team', details: null },
    { id: 'evt-internal-4', leadId: 'lead-internal-1', type: 'stage_changed', source: 'system', occurredAt: offset(1, 4), summary: 'Lead moved to qualified', details: { from: 'contacted', to: 'qualified' } },
    { id: 'evt-internal-5', leadId: 'lead-internal-2', type: 'lead_received', source: 'meta', occurredAt: offset(2, 1), summary: 'Meta instant form submitted', details: { campaign: 'REKREATIVE — Captación Centros de Psicología' } },
  ];
}

export async function seedClients(client: PoolClient): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const seedClient of getSeedClients()) {
    const result = await client.query(
      `INSERT INTO clients (id, name, sector, status, service, meta_budget_monthly, start_date, owner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        seedClient.id,
        seedClient.name,
        seedClient.sector,
        seedClient.status,
        seedClient.service,
        seedClient.metaBudgetMonthly,
        seedClient.startDate,
        seedClient.owner,
      ],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

export async function seedLeads(client: PoolClient): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const lead of buildSeedLeads()) {
    const result = await client.query(
      `INSERT INTO leads (
         id, scope, client_id, name, email, phone, whatsapp,
         lead_source, campaign, ad_creative, form, stage,
         ai_intent, ai_priority, ai_summary, ai_qualification, ai_analyzed_at,
         qualification_answers, appointment_date, conversion_value,
         created_at, last_activity_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO NOTHING`,
      [
        lead.id,
        lead.scope,
        lead.clientId,
        lead.name,
        lead.email,
        lead.phone,
        lead.whatsapp,
        lead.source,
        lead.campaign,
        lead.adCreative,
        lead.form,
        lead.stage,
        lead.aiAnalysis?.intent ?? null,
        lead.aiAnalysis?.priority ?? null,
        lead.aiAnalysis?.summary ?? null,
        lead.aiAnalysis?.qualification ? JSON.stringify(lead.aiAnalysis.qualification) : null,
        lead.aiAnalysis?.analyzedAt ?? null,
        lead.qualificationAnswers ? JSON.stringify(lead.qualificationAnswers) : null,
        lead.appointmentDate,
        lead.conversionValue,
        lead.createdAt,
        lead.lastActivityAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

export async function seedLeadEvents(client: PoolClient): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const event of buildSeedEvents()) {
    const result = await client.query(
      `INSERT INTO lead_events (id, lead_id, type, source, occurred_at, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.leadId, event.type, event.source, event.occurredAt, event.summary, event.details ? JSON.stringify(event.details) : null],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

export async function run(): Promise<void> {
  const clientsResult = { inserted: 0, skipped: 0 };
  const leadsResult = { inserted: 0, skipped: 0 };
  const eventsResult = { inserted: 0, skipped: 0 };

  await withTransaction(async (client: PoolClient) => {
    const clients = await seedClients(client);
    clientsResult.inserted = clients.inserted;
    clientsResult.skipped = clients.skipped;

    // Leads reference clients — must run after clients are committed to the
    // same transaction's view (they are: same transaction, prior statements
    // are visible to later ones in it).
    const leads = await seedLeads(client);
    leadsResult.inserted = leads.inserted;
    leadsResult.skipped = leads.skipped;

    // Events reference leads — same ordering requirement.
    const events = await seedLeadEvents(client);
    eventsResult.inserted = events.inserted;
    eventsResult.skipped = events.skipped;
  });

  console.log(`clients: ${clientsResult.inserted} inserted, ${clientsResult.skipped} already present`);
  console.log(`leads:   ${leadsResult.inserted} inserted, ${leadsResult.skipped} already present`);
  console.log(`events:  ${eventsResult.inserted} inserted, ${eventsResult.skipped} already present`);
}

// Only run the CLI when this file is executed directly (`npm run db:seed`)
// — never when imported by a test, same guard as lib/server/migrate.ts.
const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  run()
    .then(() => closePool())
    .catch(async (error) => {
      console.error('Seed failed:', error.message);
      await closePool();
      process.exit(1);
    });
}
