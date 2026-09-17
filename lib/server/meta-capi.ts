import { createHash } from 'node:crypto';
import { normalizePhoneDigits } from '@/lib/phone';
import type { LeadCollectionSummary } from '@/lib/commercial-finance';

/**
 * The business signal REKREOS is testing. These are intentionally smaller
 * than LeadStage: they are the only CRM facts we want to validate with Meta
 * before enabling any live, automatic conversion delivery.
 */
export type MetaCapiEventKind = 'qualified_lead' | 'appointment' | 'converted';
export type MetaCapiDeliveryStatus = 'pending' | 'accepted' | 'failed';

type MetaCapiEventDefinition = {
  eventName: 'Lead' | 'Schedule' | 'Purchase';
  label: string;
};

const EVENT_DEFINITIONS: Record<MetaCapiEventKind, MetaCapiEventDefinition> = {
  // Meta's standard server event is `Lead`; qualification remains a
  // REKREOS CRM fact. We deliberately do not invent a non-standard
  // `QualifiedLead` Graph event name.
  qualified_lead: { eventName: 'Lead', label: 'Lead cualificado' },
  appointment: { eventName: 'Schedule', label: 'Cita' },
  converted: { eventName: 'Purchase', label: 'Conversión' },
};

export class MetaCapiConfigurationError extends Error {
  constructor() {
    super('Meta CAPI is not configured');
    this.name = 'MetaCapiConfigurationError';
  }
}

export class MetaCapiPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaCapiPayloadValidationError';
  }
}

export type MetaCapiConfiguration = {
  accessToken: string;
  datasetId: string;
  graphApiVersion: string;
};

/**
 * Reads only server runtime configuration. No token may reach a browser,
 * timeline entry, API response, error message, or database row.
 */
export function getMetaCapiConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MetaCapiConfiguration {
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim();
  const datasetId = env.META_CAPI_DATASET_ID?.trim();
  const graphApiVersion = env.META_CAPI_GRAPH_VERSION?.trim() || 'v24.0';
  if (!accessToken || !datasetId || !/^\d{5,30}$/.test(datasetId) || !/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new MetaCapiConfigurationError();
  }
  return { accessToken, datasetId, graphApiVersion };
}

export function getMetaCapiEventDefinition(kind: MetaCapiEventKind): MetaCapiEventDefinition {
  return EVENT_DEFINITIONS[kind];
}

type MetaCapiRequestLead = {
  id: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  conversionCollection?: LeadCollectionSummary;
};

type MetaCapiUserData = {
  em?: string[];
  ph?: string[];
};

export type MetaCapiTestRequest = {
  path: string;
  body: {
    data: Array<{
      event_name: 'Lead' | 'Schedule' | 'Purchase';
      event_time: number;
      event_id: string;
      action_source: 'system_generated';
      user_data: MetaCapiUserData;
      custom_data?: { currency: 'EUR'; value: number };
    }>;
    test_event_code: string;
  };
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizedPhone(value: string | null): string | null {
  const digits = value ? normalizePhoneDigits(value) : '';
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Builds the narrow, test-only CAPI request. The returned body contains
 * only SHA-256 hashes for contact identifiers. The test code stays in
 * process memory for this request and is never persisted.
 */
export function buildMetaCapiTestRequest(input: {
  datasetId: string;
  graphApiVersion?: string;
  testEventCode: string;
  lead: MetaCapiRequestLead;
  kind: MetaCapiEventKind;
  occurredAt: Date;
}): MetaCapiTestRequest {
  const email = normalizedEmail(input.lead.email);
  const phone = normalizedPhone(input.lead.whatsapp) ?? normalizedPhone(input.lead.phone);
  const userData: MetaCapiUserData = {
    ...(email ? { em: [sha256(email)] } : {}),
    ...(phone ? { ph: [sha256(phone)] } : {}),
  };
  if (!email && !phone) {
    throw new MetaCapiPayloadValidationError('a valid email or phone is required for Meta CAPI');
  }

  const definition = getMetaCapiEventDefinition(input.kind);
  const event = {
    event_name: definition.eventName,
    event_time: Math.floor(input.occurredAt.getTime() / 1000),
    event_id: `rekreos-test-${input.lead.id}-${input.kind}`,
    action_source: 'system_generated' as const,
    user_data: userData,
    ...(input.kind === 'converted'
      ? (() => {
          const collected = input.lead.conversionCollection?.totalCollected ?? 0;
          if (!Number.isFinite(collected) || collected <= 0) {
            throw new MetaCapiPayloadValidationError('actual money collected is required for a conversion test');
          }
          return { custom_data: { currency: 'EUR' as const, value: collected } };
        })()
      : {}),
  };

  const graphApiVersion = input.graphApiVersion ?? 'v24.0';
  return {
    path: `/${graphApiVersion}/${input.datasetId}/events`,
    body: { data: [event], test_event_code: input.testEventCode },
  };
}

export type MetaCapiSendResult =
  | { status: 'accepted' }
  | { status: 'failed'; errorCode: 'provider_rejected' | 'network_error' | 'empty_response' };

/**
 * Sends a test request to Meta. It intentionally returns a small, sanitized
 * outcome: Graph response bodies can contain operational data and must not
 * be copied into REKREOS's database or back to the browser.
 */
export async function sendMetaCapiTestRequest(
  config: MetaCapiConfiguration,
  request: MetaCapiTestRequest,
): Promise<MetaCapiSendResult> {
  try {
    const response = await fetch(`https://graph.facebook.com${request.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Meta accepts access_token as a Graph API parameter. Keep it in the
      // POST body, never URL/query logs or a client-visible header.
      body: JSON.stringify({ ...request.body, access_token: config.accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: 'failed', errorCode: 'provider_rejected' };
    const result = (await response.json().catch(() => null)) as { events_received?: unknown } | null;
    if (!result || (typeof result.events_received === 'number' && result.events_received < 1)) {
      return { status: 'failed', errorCode: 'empty_response' };
    }
    return { status: 'accepted' };
  } catch {
    return { status: 'failed', errorCode: 'network_error' };
  }
}
