import { getClients } from '@/lib/clients';
import { isBrowserDemoDataEnabled, withoutDemoRecords } from '@/lib/demo-data';

// REKREATIVE is the agency's own internal acquisition/infrastructure, never
// a client — scope distinguishes "REKREATIVE's own automations" (internal,
// clientId null) from "a client's automations" (client, clientId required).
// Same invariant style as lib/leads.ts / lib/meta-ads.ts / lib/content-
// items.ts. Deliberately independent of AutomationPlatform — the "Interno"
// platform chip (AUTOMATION_PLATFORM_OPTIONS below) describes a step's
// tooling, never who owns the automation; an internal-scope automation can
// use Meta/Make/OpenAI/WhatsApp, and a client automation can still contain
// an "Interno" platform step. Never model REKREATIVE as a fake Client row.
export const AUTOMATION_SCOPE_OPTIONS = [
  { id: 'internal', label: 'REKREATIVE' },
  { id: 'client', label: 'Clientes' },
] as const;
export type AutomationScope = (typeof AUTOMATION_SCOPE_OPTIONS)[number]['id'];

// ── Lifecycle status — who/what decided this automation should run ─────────
// Deliberately excludes "error": operational problems are DERIVED from run
// state (see AutomationHealth below), never stored as a lifecycle value.
export const AUTOMATION_STATUS_OPTIONS = [
  { id: 'active', label: 'Activa' },
  { id: 'paused', label: 'Pausada' },
  { id: 'draft', label: 'Borrador' },
] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUS_OPTIONS)[number]['id'];

// ── Health — always derived, never persisted (see getAutomationHealth) ─────
// "Operativa" (health) is deliberately distinct from "Activa" (lifecycle
// status above) — a paused automation is never healthy/unhealthy, and an
// active one can still be unhealthy. Do not collapse the two vocabularies.
export const AUTOMATION_HEALTH_OPTIONS = [
  { id: 'healthy', label: 'Operativa' },
  { id: 'needs_attention', label: 'Requiere atención' },
  { id: 'never_run', label: 'Sin ejecuciones' },
] as const;
export type AutomationHealth = (typeof AUTOMATION_HEALTH_OPTIONS)[number]['id'];

export const AUTOMATION_PLATFORM_OPTIONS = [
  { id: 'make', label: 'Make' },
  { id: 'manychat', label: 'ManyChat' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'meta', label: 'Meta' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google_sheets', label: 'Google Sheets' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'internal', label: 'Interno' },
] as const;
export type AutomationPlatform = (typeof AUTOMATION_PLATFORM_OPTIONS)[number]['id'];

export const AUTOMATION_TYPE_OPTIONS = [
  { id: 'lead_response', label: 'Respuesta a lead' },
  { id: 'qualification', label: 'Cualificación' },
  { id: 'nurture', label: 'Nutrición' },
  { id: 'notification', label: 'Notificación' },
  { id: 'reporting', label: 'Informes' },
  { id: 'other', label: 'Otro' },
] as const;
export type AutomationType = (typeof AUTOMATION_TYPE_OPTIONS)[number]['id'];

export const AUTOMATION_RUN_STATUS_OPTIONS = [
  { id: 'success', label: 'Correcto' },
  { id: 'failed', label: 'Fallido' },
  { id: 'running', label: 'En curso' },
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUS_OPTIONS)[number]['id'];

/**
 * 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI,
 * 'live' = reserved for a future real Make/ManyChat/WhatsApp integration.
 * Never set 'live' before that integration exists — same honesty rule as
 * lib/meta-ads.ts's MetaCampaignDataSource and lib/connectors/*'s ConnectorStatus.
 */
export type AutomationDataSource = 'demo' | 'manual' | 'live';

/** Who/what produced a run record — a platform once real integrations exist, or this UI/seed data until then. */
export type AutomationRunSource = AutomationPlatform | 'demo' | 'manual' | 'system';

export type AutomationStep = {
  id: string;
  order: number;
  platform: AutomationPlatform;
  action: string;
  description: string;
};

export type AutomationTrigger = {
  platform: AutomationPlatform;
  event: string;
  description: string;
};

export type Automation = {
  id: string;
  scope: AutomationScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  /** Future Make/ManyChat/WhatsApp scenario id once a live integration exists. Null until then. */
  externalProvider: AutomationPlatform | null;
  externalAutomationId: string | null;

  name: string;
  description: string;

  status: AutomationStatus;
  type: AutomationType;

  platforms: AutomationPlatform[];

  trigger: AutomationTrigger;
  steps: AutomationStep[];

  /** Denormalized from the latest AutomationRun — written only via appendAutomationRun(). */
  lastRunAt: string | null;
  lastRunStatus: AutomationRunStatus | null;
  lastError: string | null;

  createdAt: string;
  updatedAt: string;

  dataSource: AutomationDataSource;
};

export type AutomationRun = {
  id: string;
  automationId: string;

  status: AutomationRunStatus;
  startedAt: string;
  /** Null while status is 'running'. */
  finishedAt: string | null;

  summary: string;
  error: string | null;

  source: AutomationRunSource;
};

export type CreateAutomationInput = {
  /** Defaults to 'client' when omitted — preserves every existing call
   * site's prior behavior (a required clientId) without a migration. */
  scope?: AutomationScope;
  clientId?: string | null;
  externalProvider?: AutomationPlatform | null;
  externalAutomationId?: string | null;
  name: string;
  description?: string;
  status?: AutomationStatus;
  type: AutomationType;
  platforms: AutomationPlatform[];
  trigger: AutomationTrigger;
  steps?: Omit<AutomationStep, 'order'>[];
  dataSource?: AutomationDataSource;
};

/** lastRunAt/lastRunStatus/lastError may only change through appendAutomationRun(). */
export type UpdateAutomationInput = Partial<
  Omit<Automation, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastError'>
>;

const STORAGE_KEY = 'rek_automations_v1';
const RUNS_STORAGE_KEY = 'rek_automation_runs_v1';

// ===== RAW STORAGE (kept private to this module) =====

function readStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
    return [];
  }
}

function getStorageRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

function writeStorage<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function assertScopeInvariant(scope: AutomationScope, clientId: string | null): void {
  if (scope === 'client') {
    if (!clientId) {
      throw new Error('A client-scoped automation requires a clientId');
    }
    if (!getClients().some((client) => client.id === clientId)) {
      throw new Error('Cannot create automation for a missing client id');
    }
  }
}

/** Safe read-time migration: every Automation persisted before `scope`
 * existed (JSON.parse yields `undefined`) was, by definition, a client
 * automation — this repo had no internal-automation concept until now.
 * Backfilling here means existing seeded/manual data is never rewritten or
 * lost, only the new field is filled in, the same way every time it's read
 * (same pattern as lib/leads.ts's normalizeLead / lib/meta-ads.ts's
 * normalizeCampaign). */
function normalizeAutomation(raw: Automation): Automation {
  if (raw.scope === 'internal' || raw.scope === 'client') return raw;
  return { ...raw, scope: 'client' };
}

function readAutomations(): Automation[] {
  const automations = readStorage<Automation>(STORAGE_KEY).map(normalizeAutomation);
  return isBrowserDemoDataEnabled() ? automations : withoutDemoRecords(automations);
}

// ===== SEED / DEMO DATA =====
// Intentionally obvious REKREATIVE-style demo automations — replace with a
// live Make/ManyChat/WhatsApp integration later without touching this module's
// public API. Spread across the seeded REKREATIVE clients (see lib/clients.ts)
// with enough variation to exercise every status, health, and platform.

function seedDemoAutomations(): Automation[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  return [
    {
      id: 'automation-meta-lead-whatsapp',
      scope: 'client',
      clientId: 'client-acme',
      externalProvider: 'make',
      externalAutomationId: 'make-scenario-48213',
      name: 'Meta Lead → WhatsApp Welcome',
      description:
        'Meta lead form triggers a Make scenario: OpenAI qualifies the lead, logs it to the REKREATIVE CRM and the client tracking sheet, then WhatsApp Business Cloud sends the welcome template.',
      status: 'active',
      type: 'lead_response',
      platforms: ['meta', 'make', 'openai', 'google_sheets', 'whatsapp', 'internal'],
      trigger: {
        platform: 'meta',
        event: 'New Lead Ad form submission',
        description: 'Fires when a lead submits a Meta instant form on an active ad set.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'make', action: 'Receive Make webhook', description: 'Make scenario receives the raw Meta lead payload.' },
        { id: 'step-2', order: 2, platform: 'openai', action: 'Qualify lead', description: 'OpenAI scores intent and extracts qualification fields.' },
        { id: 'step-3', order: 3, platform: 'internal', action: 'Create CRM lead', description: 'Lead is written into the REKREATIVE Leads CRM with AI analysis attached.' },
        { id: 'step-4', order: 4, platform: 'google_sheets', action: 'Log to tracking sheet', description: 'A row is appended to the client reporting sheet.' },
        { id: 'step-5', order: 5, platform: 'whatsapp', action: 'Send welcome template', description: 'WhatsApp Business Cloud sends the approved welcome template.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    {
      id: 'automation-appointment-reminder',
      scope: 'client',
      clientId: 'client-northwind',
      externalProvider: 'make',
      externalAutomationId: 'make-scenario-51890',
      name: 'Appointment Reminder — WhatsApp',
      description: 'When a discovery call is booked in the CRM calendar, a Make scenario sends a WhatsApp reminder template 24h before the call.',
      status: 'active',
      type: 'notification',
      platforms: ['calendar', 'make', 'whatsapp', 'internal'],
      trigger: {
        platform: 'calendar',
        event: 'Appointment booked in CRM calendar',
        description: 'Fires when a lead moves to the Appointment stage with a confirmed date.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'calendar', action: 'Detect booked appointment', description: 'Calendar entry with a confirmed date and phone number.' },
        { id: 'step-2', order: 2, platform: 'make', action: 'Schedule reminder', description: 'Make scenario schedules a delayed send 24h before the appointment.' },
        { id: 'step-3', order: 3, platform: 'whatsapp', action: 'Send reminder template', description: 'WhatsApp Business Cloud sends the appointment reminder template.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    {
      id: 'automation-ig-nurture',
      scope: 'client',
      clientId: 'client-lumen',
      externalProvider: 'manychat',
      externalAutomationId: 'manychat-flow-7742',
      name: 'Instagram DM Nurture — ManyChat',
      description: 'Contacts tagged "warm" in ManyChat receive a 3-message nurture sequence over Instagram DMs. Paused while the creative brief is refreshed.',
      status: 'paused',
      type: 'nurture',
      platforms: ['manychat', 'meta'],
      trigger: {
        platform: 'manychat',
        event: 'Contact tagged "warm" in ManyChat',
        description: 'Fires when a manual or automated tag marks a contact as warm.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'manychat', action: 'Send intro DM', description: 'First nurture message introducing the studio.' },
        { id: 'step-2', order: 2, platform: 'manychat', action: 'Send portfolio DM', description: 'Follow-up message with portfolio highlights, sent 2 days later.' },
        { id: 'step-3', order: 3, platform: 'manychat', action: 'Send offer DM', description: 'Closing message with a booking link, sent 5 days later.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(90),
      updatedAt: daysAgo(9),
      dataSource: 'demo',
    },
    {
      id: 'automation-review-request',
      scope: 'client',
      clientId: 'client-acme',
      externalProvider: null,
      externalAutomationId: null,
      name: 'Post-Conversion Review Request',
      description: 'Draft automation: once a lead is marked converted in the CRM, send a WhatsApp message asking for a review. Not yet launched.',
      status: 'draft',
      type: 'other',
      platforms: ['internal', 'whatsapp'],
      trigger: {
        platform: 'internal',
        event: 'Lead marked converted in CRM',
        description: 'Fires when a lead’s stage changes to Converted.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'internal', action: 'Detect conversion', description: 'CRM stage change to Converted.' },
        { id: 'step-2', order: 2, platform: 'whatsapp', action: 'Send review request', description: 'WhatsApp message with a review link, pending template approval.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
      dataSource: 'demo',
    },
    {
      id: 'automation-onboarding-notification',
      scope: 'client',
      clientId: 'client-northwind',
      externalProvider: null,
      externalAutomationId: null,
      name: 'New Client Onboarding Notification',
      description: 'Active but never triggered yet: notifies the internal team and logs a row in Google Sheets whenever a client’s status changes to active.',
      status: 'active',
      type: 'notification',
      platforms: ['internal', 'google_sheets'],
      trigger: {
        platform: 'internal',
        event: 'Client status changes to active',
        description: 'Fires when a client record’s status field flips to active.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'internal', action: 'Detect status change', description: 'Client status transitions to active.' },
        { id: 'step-2', order: 2, platform: 'google_sheets', action: 'Log onboarding row', description: 'Row appended to the internal onboarding tracker.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      dataSource: 'demo',
    },
    {
      id: 'automation-weekly-digest',
      scope: 'client',
      clientId: 'client-lumen',
      externalProvider: null,
      externalAutomationId: null,
      name: 'Weekly Performance Digest',
      description: 'Every Monday, aggregates the past week’s lead and campaign numbers into the client tracking sheet.',
      status: 'active',
      type: 'reporting',
      platforms: ['internal', 'google_sheets'],
      trigger: {
        platform: 'internal',
        event: 'Every Monday 08:00',
        description: 'Scheduled trigger, once a week.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'internal', action: 'Aggregate weekly numbers', description: 'Pulls the past 7 days of leads and campaign metrics.' },
        { id: 'step-2', order: 2, platform: 'google_sheets', action: 'Write digest sheet', description: 'Writes the summary into the client Google Sheet.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(75),
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    // REKREATIVE's own internal infrastructure — never a client. scope:
    // 'internal', clientId: null. Feeds lead-internal-1/2 and
    // campaign-internal-1 (lib/leads.ts / lib/meta-ads.ts). Kept small —
    // 2 automations, not a full internal ops suite.
    {
      id: 'automation-internal-lead-intake',
      scope: 'internal',
      clientId: null,
      externalProvider: 'make',
      externalAutomationId: 'make-scenario-internal-77210',
      name: 'REKREATIVE Lead Intake → IA → WhatsApp',
      description:
        'Meta lead form for REKREATIVE\'s own Captación Centros de Psicología campaign triggers a Make scenario: OpenAI qualifies the prospect, logs it into REKREATIVE\'s own CRM, then WhatsApp Business Cloud sends the welcome template.',
      status: 'active',
      type: 'lead_response',
      platforms: ['meta', 'make', 'openai', 'whatsapp', 'internal'],
      trigger: {
        platform: 'meta',
        event: 'New Lead Ad form submission',
        description: 'Fires when a prospect submits REKREATIVE\'s own Meta instant form.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'make', action: 'Receive Make webhook', description: 'Make scenario receives the raw Meta lead payload.' },
        { id: 'step-2', order: 2, platform: 'openai', action: 'Qualify prospect', description: 'OpenAI scores intent and extracts qualification fields.' },
        { id: 'step-3', order: 3, platform: 'internal', action: 'Create CRM lead', description: 'Prospect is written into REKREATIVE\'s own Leads CRM (scope: internal) with AI analysis attached.' },
        { id: 'step-4', order: 4, platform: 'whatsapp', action: 'Send welcome template', description: 'WhatsApp Business Cloud sends the approved welcome template.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    {
      id: 'automation-internal-digest',
      scope: 'internal',
      clientId: null,
      externalProvider: null,
      externalAutomationId: null,
      name: 'REKREATIVE Lead Alert / Daily Digest',
      description: 'Every morning, summarizes new REKREATIVE-internal leads and their stage changes for the team.',
      status: 'active',
      type: 'reporting',
      platforms: ['internal', 'google_sheets'],
      trigger: {
        platform: 'internal',
        event: 'Every day 08:00',
        description: 'Scheduled trigger, once a day.',
      },
      steps: [
        { id: 'step-1', order: 1, platform: 'internal', action: 'Aggregate daily numbers', description: 'Pulls the past 24h of REKREATIVE-internal leads and stage changes.' },
        { id: 'step-2', order: 2, platform: 'google_sheets', action: 'Write digest sheet', description: 'Writes the summary into REKREATIVE\'s own internal tracker.' },
      ],
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: daysAgo(45),
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
  ];
}

function seedDemoAutomationRuns(): AutomationRun[] {
  const now = new Date();
  const hoursAgo = (hours: number) => {
    const d = new Date(now);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  };

  const runs: AutomationRun[] = [
    // automation-meta-lead-whatsapp — active, healthy: one early failure, now succeeding
    { id: 'run-mlw-1', automationId: 'automation-meta-lead-whatsapp', status: 'failed', startedAt: hoursAgo(240), finishedAt: hoursAgo(240), summary: 'Run failed before completion', error: 'WhatsApp template send timed out', source: 'make' },
    { id: 'run-mlw-2', automationId: 'automation-meta-lead-whatsapp', status: 'success', startedAt: hoursAgo(190), finishedAt: hoursAgo(190), summary: 'Lead qualified and welcome template delivered', error: null, source: 'make' },
    { id: 'run-mlw-3', automationId: 'automation-meta-lead-whatsapp', status: 'success', startedAt: hoursAgo(96), finishedAt: hoursAgo(96), summary: 'Lead qualified and welcome template delivered', error: null, source: 'make' },
    { id: 'run-mlw-4', automationId: 'automation-meta-lead-whatsapp', status: 'success', startedAt: hoursAgo(20), finishedAt: hoursAgo(20), summary: 'Lead qualified and welcome template delivered', error: null, source: 'make' },

    // automation-appointment-reminder — active, needs_attention: last run failed
    { id: 'run-ar-1', automationId: 'automation-appointment-reminder', status: 'success', startedAt: hoursAgo(300), finishedAt: hoursAgo(300), summary: 'Reminder delivered', error: null, source: 'make' },
    { id: 'run-ar-2', automationId: 'automation-appointment-reminder', status: 'success', startedAt: hoursAgo(150), finishedAt: hoursAgo(150), summary: 'Reminder delivered', error: null, source: 'make' },
    { id: 'run-ar-3', automationId: 'automation-appointment-reminder', status: 'failed', startedAt: hoursAgo(12), finishedAt: hoursAgo(12), summary: 'Run failed before completion', error: 'WhatsApp template not approved for this variant', source: 'make' },

    // automation-ig-nurture — paused, but has run history from before it was paused
    { id: 'run-ign-1', automationId: 'automation-ig-nurture', status: 'success', startedAt: hoursAgo(400), finishedAt: hoursAgo(400), summary: 'Nurture sequence completed', error: null, source: 'manychat' },
    { id: 'run-ign-2', automationId: 'automation-ig-nurture', status: 'success', startedAt: hoursAgo(260), finishedAt: hoursAgo(260), summary: 'Nurture sequence completed', error: null, source: 'manychat' },

    // automation-weekly-digest — active, healthy, recurring
    { id: 'run-wd-1', automationId: 'automation-weekly-digest', status: 'success', startedAt: hoursAgo(504), finishedAt: hoursAgo(504), summary: 'Digest written to Google Sheets', error: null, source: 'system' },
    { id: 'run-wd-2', automationId: 'automation-weekly-digest', status: 'success', startedAt: hoursAgo(336), finishedAt: hoursAgo(336), summary: 'Digest written to Google Sheets', error: null, source: 'system' },
    { id: 'run-wd-3', automationId: 'automation-weekly-digest', status: 'success', startedAt: hoursAgo(168), finishedAt: hoursAgo(168), summary: 'Digest written to Google Sheets', error: null, source: 'system' },

    // automation-review-request and automation-onboarding-notification are intentionally never run.

    // automation-internal-lead-intake — active, healthy: REKREATIVE's own
    // funnel, recurring successful runs.
    { id: 'run-ili-1', automationId: 'automation-internal-lead-intake', status: 'success', startedAt: hoursAgo(160), finishedAt: hoursAgo(160), summary: 'Prospect qualified and welcome template delivered', error: null, source: 'make' },
    { id: 'run-ili-2', automationId: 'automation-internal-lead-intake', status: 'success', startedAt: hoursAgo(48), finishedAt: hoursAgo(48), summary: 'Prospect qualified and welcome template delivered', error: null, source: 'make' },
    { id: 'run-ili-3', automationId: 'automation-internal-lead-intake', status: 'success', startedAt: hoursAgo(6), finishedAt: hoursAgo(6), summary: 'Prospect qualified and welcome template delivered', error: null, source: 'make' },

    // automation-internal-digest — active, healthy, recurring daily.
    { id: 'run-idg-1', automationId: 'automation-internal-digest', status: 'success', startedAt: hoursAgo(72), finishedAt: hoursAgo(72), summary: 'Digest written to internal tracker', error: null, source: 'system' },
    { id: 'run-idg-2', automationId: 'automation-internal-digest', status: 'success', startedAt: hoursAgo(48), finishedAt: hoursAgo(48), summary: 'Digest written to internal tracker', error: null, source: 'system' },
    { id: 'run-idg-3', automationId: 'automation-internal-digest', status: 'success', startedAt: hoursAgo(24), finishedAt: hoursAgo(24), summary: 'Digest written to internal tracker', error: null, source: 'system' },
  ];

  return runs;
}

// ===== STORE INITIALIZATION =====

export function initializeAutomationsStoreIfNeeded(): Automation[] {
  if (typeof window === 'undefined') {
    return isBrowserDemoDataEnabled() ? seedDemoAutomations() : [];
  }

  if (!isBrowserDemoDataEnabled()) {
    const existing = readAutomations();
    const retainedIds = new Set(existing.map((automation) => automation.id));
    const retainedRuns = readStorage<AutomationRun>(RUNS_STORAGE_KEY)
      .filter((run) => retainedIds.has(run.automationId));
    writeStorage(STORAGE_KEY, existing);
    writeStorage(RUNS_STORAGE_KEY, retainedRuns);
    return existing;
  }

  const automationsRaw = getStorageRaw(STORAGE_KEY);
  const runsRaw = getStorageRaw(RUNS_STORAGE_KEY);

  if (!automationsRaw) {
    const seeded = seedDemoAutomations();
    const runs = seedDemoAutomationRuns();
    writeStorage(RUNS_STORAGE_KEY, runs);
    const stamped = applySeedRunDenormalization(seeded, runs);
    writeStorage(STORAGE_KEY, stamped);
    return stamped;
  }

  let existing: Automation[] = [];
  try {
    const parsed = JSON.parse(automationsRaw);
    existing = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse automations from localStorage; leaving existing store intact.', error);
  }

  if (!runsRaw) {
    const seededRuns = seedDemoAutomationRuns().filter((run) => existing.some((a) => a.id === run.automationId));
    writeStorage(RUNS_STORAGE_KEY, seededRuns);
    return existing;
  }

  try {
    const parsedRuns = JSON.parse(runsRaw);
    if (!Array.isArray(parsedRuns)) {
      const seededRuns = seedDemoAutomationRuns().filter((run) => existing.some((a) => a.id === run.automationId));
      writeStorage(RUNS_STORAGE_KEY, seededRuns);
    }
  } catch (error) {
    console.error('Failed to parse automation runs from localStorage; reinitializing the run store safely.', error);
    const seededRuns = seedDemoAutomationRuns().filter((run) => existing.some((a) => a.id === run.automationId));
    writeStorage(RUNS_STORAGE_KEY, seededRuns);
  }

  return existing.length ? existing : seedDemoAutomations();
}

/** First-touch only: stamps lastRunAt/lastRunStatus/lastError onto freshly seeded automations from their seeded runs, exactly what appendAutomationRun() would have done one run at a time. */
function applySeedRunDenormalization(automations: Automation[], runs: AutomationRun[]): Automation[] {
  const latestByAutomation = new Map<string, AutomationRun>();
  for (const run of runs) {
    const current = latestByAutomation.get(run.automationId);
    if (!current || new Date(run.startedAt).getTime() > new Date(current.startedAt).getTime()) {
      latestByAutomation.set(run.automationId, run);
    }
  }

  return automations.map((automation) => {
    const latest = latestByAutomation.get(automation.id);
    if (!latest) return automation;
    return {
      ...automation,
      lastRunAt: latest.finishedAt ?? latest.startedAt,
      lastRunStatus: latest.status,
      lastError: latest.status === 'failed' ? latest.error ?? latest.summary : null,
    };
  });
}

// ===== READ =====

/** No clientId → every automation (internal + client — see AUTOMATIONS-
 * scope filtering in components/AutomationsBoard.tsx). A clientId → only
 * that client's own automations (never internal, never another client's) —
 * the exact contract Client Workspace's ClientAutomationsPanel relies on
 * for isolation. */
export function getAutomations(clientId?: string): Automation[] {
  const automations = readAutomations();
  const result = !clientId ? automations : automations.filter((automation) => automation.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getAutomationById(id: string): Automation | null {
  return readAutomations().find((automation) => automation.id === id) ?? null;
}

export function getAutomationRuns(automationId: string): AutomationRun[] {
  return readStorage<AutomationRun>(RUNS_STORAGE_KEY)
    .filter((run) => run.automationId === automationId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

// ===== WRITE =====

export function createAutomation(input: CreateAutomationInput): Automation {
  const scope: AutomationScope = input.scope ?? 'client';
  const clientId = scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(scope, clientId);

  const now = isoNow();
  const created: Automation = {
    id: `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope,
    clientId,
    externalProvider: input.externalProvider ?? null,
    externalAutomationId: input.externalAutomationId?.trim() || null,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    status: input.status ?? 'draft',
    type: input.type,
    platforms: input.platforms,
    trigger: input.trigger,
    steps: (input.steps ?? []).map((step, index) => ({ ...step, order: index + 1 })),
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const automations = readAutomations();
  writeStorage(STORAGE_KEY, [created, ...automations]);
  return created;
}

export function updateAutomation(id: string, patch: UpdateAutomationInput): Automation | null {
  const automations = readAutomations();
  const index = automations.findIndex((automation) => automation.id === id);
  if (index === -1) return null;

  const merged: Automation = {
    ...automations[index],
    ...patch,
    updatedAt: isoNow(),
  };

  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  automations[index] = merged;
  writeStorage(STORAGE_KEY, automations);
  return merged;
}

export function setAutomationStatus(id: string, status: AutomationStatus): Automation | null {
  return updateAutomation(id, { status });
}

/** The only way lastRunAt/lastRunStatus/lastError may change — kept centralized for future real Make/ManyChat/WhatsApp integrations to call. */
export function appendAutomationRun(
  automationId: string,
  input: {
    status: AutomationRunStatus;
    summary: string;
    error?: string | null;
    source?: AutomationRunSource;
    startedAt?: string;
    finishedAt?: string | null;
  },
): AutomationRun {
  const startedAt = input.startedAt ?? isoNow();
  const finishedAt = input.status === 'running' ? input.finishedAt ?? null : input.finishedAt ?? startedAt;

  const created: AutomationRun = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    automationId,
    status: input.status,
    startedAt,
    finishedAt,
    summary: input.summary,
    error: input.error ?? null,
    source: input.source ?? 'manual',
  };

  const runs = readStorage<AutomationRun>(RUNS_STORAGE_KEY);
  writeStorage(RUNS_STORAGE_KEY, [...runs, created]);

  const automations = readAutomations();
  const index = automations.findIndex((automation) => automation.id === automationId);
  if (index >= 0) {
    automations[index] = {
      ...automations[index],
      lastRunAt: created.finishedAt ?? created.startedAt,
      lastRunStatus: created.status,
      lastError: created.status === 'failed' ? created.error ?? created.summary : null,
      updatedAt: isoNow(),
    };
    writeStorage(STORAGE_KEY, automations);
  }

  return created;
}

// ===== DERIVED (never persisted) =====

/** Health is always computed from run state — never stored. */
export function getAutomationHealth(automation: Pick<Automation, 'lastRunAt' | 'lastRunStatus'>): AutomationHealth {
  if (!automation.lastRunAt || !automation.lastRunStatus) return 'never_run';
  return automation.lastRunStatus === 'failed' ? 'needs_attention' : 'healthy';
}

export type AutomationRunStats = {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  /** Null when there are zero completed (success + failed) runs — render as "—", never as 0%. */
  successRate: number | null;
};

export function getAutomationRunStats(runs: AutomationRun[]): AutomationRunStats {
  const totalRuns = runs.length;
  const successfulRuns = runs.filter((run) => run.status === 'success').length;
  const failedRuns = runs.filter((run) => run.status === 'failed').length;
  const completed = successfulRuns + failedRuns;

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate: completed > 0 ? successfulRuns / completed : null,
  };
}

export function getAutomationStats(automationId: string): AutomationRunStats {
  return getAutomationRunStats(getAutomationRuns(automationId));
}

export type AutomationsSummary = {
  active: number;
  needsAttention: number;
  totalRuns: number;
  totalFailures: number;
  successRate: number | null;
};

/** Aggregate KPI totals over a set of automations, with run stats computed across only their runs. */
export function summarizeAutomations(automations: Automation[]): AutomationsSummary {
  const ids = new Set(automations.map((automation) => automation.id));
  const relevantRuns = readStorage<AutomationRun>(RUNS_STORAGE_KEY).filter((run) => ids.has(run.automationId));
  const runStats = getAutomationRunStats(relevantRuns);

  return {
    active: automations.filter((automation) => automation.status === 'active').length,
    needsAttention: automations.filter((automation) => getAutomationHealth(automation) === 'needs_attention').length,
    totalRuns: runStats.totalRuns,
    totalFailures: runStats.failedRuns,
    successRate: runStats.successRate,
  };
}

// ===== LABELS =====

/**
 * Pass the caller's own already-loaded `clients` (the canonical PostgreSQL
 * registry, e.g. from useClientsRegistry()) wherever one is available —
 * that's what keeps this in sync with the real Client registry instead of
 * the legacy localStorage seed. Automation records themselves stay
 * localStorage; only client identity resolution moved.
 */
export function getClientNameForAutomation(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'Interno';
  const client = clients.find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getStatusLabel(status: AutomationStatus): string {
  return AUTOMATION_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getHealthLabel(health: AutomationHealth): string {
  return AUTOMATION_HEALTH_OPTIONS.find((option) => option.id === health)?.label ?? health;
}

export function getPlatformLabel(platform: AutomationPlatform): string {
  return AUTOMATION_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

export function getTypeLabel(type: AutomationType): string {
  return AUTOMATION_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

export function getRunStatusLabel(status: AutomationRunStatus): string {
  return AUTOMATION_RUN_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}
