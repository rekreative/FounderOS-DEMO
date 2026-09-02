import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  InternalBusinessProfile,
  InternalBusinessService,
  InternalBusinessWorkspace,
  SaveInternalBusinessWorkspaceInput,
} from '@/lib/business';
import { query, withTransaction } from './db';

type ProfileRow = {
  display_name: string;
  description: string;
  owner_name: string;
  timezone: string;
  currency: string;
  monthly_revenue_target: string;
  monthly_new_clients_min: number;
  monthly_new_clients_target: number;
  monthly_new_clients_max: number;
  monthly_leads_min: number;
  monthly_leads_target: number;
  monthly_leads_max: number;
  monthly_appointments_target: number;
  acquisition_channels: unknown;
  tools: unknown;
  commercial_policy: string;
  updated_at: Date;
};

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  billing_type: string;
  allow_two_payments: boolean;
  second_payment_trigger: string | null;
  active: boolean;
  sort_order: number;
  updated_at: Date;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapProfile(row: ProfileRow): InternalBusinessProfile {
  return {
    displayName: row.display_name,
    description: row.description,
    ownerName: row.owner_name,
    timezone: row.timezone,
    currency: row.currency,
    monthlyRevenueTarget: Number(row.monthly_revenue_target),
    monthlyNewClientsMin: row.monthly_new_clients_min,
    monthlyNewClientsTarget: row.monthly_new_clients_target,
    monthlyNewClientsMax: row.monthly_new_clients_max,
    monthlyLeadsMin: row.monthly_leads_min,
    monthlyLeadsTarget: row.monthly_leads_target,
    monthlyLeadsMax: row.monthly_leads_max,
    monthlyAppointmentsTarget: row.monthly_appointments_target,
    acquisitionChannels: stringArray(row.acquisition_channels),
    tools: stringArray(row.tools),
    commercialPolicy: row.commercial_policy,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapService(row: ServiceRow): InternalBusinessService {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    billingType: row.billing_type as InternalBusinessService['billingType'],
    allowTwoPayments: row.allow_two_payments,
    secondPaymentTrigger: row.second_payment_trigger,
    active: row.active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getInternalBusinessWorkspace(): Promise<InternalBusinessWorkspace> {
  const [profileResult, servicesResult] = await Promise.all([
    query<ProfileRow>("SELECT * FROM internal_business_profile WHERE workspace_key = 'rekreative'"),
    query<ServiceRow>('SELECT * FROM internal_business_services ORDER BY active DESC, sort_order, name'),
  ]);
  return {
    profile: profileResult.rowCount === 0 ? null : mapProfile(profileResult.rows[0]),
    services: servicesResult.rows.map(mapService),
  };
}

async function saveProfile(client: PoolClient, input: SaveInternalBusinessWorkspaceInput['profile'], userId: string): Promise<void> {
  await client.query(
    `INSERT INTO internal_business_profile (
       workspace_key, display_name, description, owner_name, timezone, currency,
       monthly_revenue_target, monthly_new_clients_min, monthly_new_clients_target,
       monthly_new_clients_max, monthly_leads_min, monthly_leads_target,
       monthly_leads_max, monthly_appointments_target, acquisition_channels,
       tools, commercial_policy, created_by, updated_by
     ) VALUES ('rekreative', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $17)
     ON CONFLICT (workspace_key) DO UPDATE SET
       display_name = EXCLUDED.display_name, description = EXCLUDED.description,
       owner_name = EXCLUDED.owner_name, timezone = EXCLUDED.timezone,
       currency = EXCLUDED.currency, monthly_revenue_target = EXCLUDED.monthly_revenue_target,
       monthly_new_clients_min = EXCLUDED.monthly_new_clients_min,
       monthly_new_clients_target = EXCLUDED.monthly_new_clients_target,
       monthly_new_clients_max = EXCLUDED.monthly_new_clients_max,
       monthly_leads_min = EXCLUDED.monthly_leads_min,
       monthly_leads_target = EXCLUDED.monthly_leads_target,
       monthly_leads_max = EXCLUDED.monthly_leads_max,
       monthly_appointments_target = EXCLUDED.monthly_appointments_target,
       acquisition_channels = EXCLUDED.acquisition_channels, tools = EXCLUDED.tools,
       commercial_policy = EXCLUDED.commercial_policy, updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.displayName, input.description, input.ownerName, input.timezone, input.currency,
      input.monthlyRevenueTarget, input.monthlyNewClientsMin, input.monthlyNewClientsTarget,
      input.monthlyNewClientsMax, input.monthlyLeadsMin, input.monthlyLeadsTarget,
      input.monthlyLeadsMax, input.monthlyAppointmentsTarget,
      JSON.stringify(input.acquisitionChannels), JSON.stringify(input.tools), input.commercialPolicy, userId,
    ],
  );
}

function newServiceId(): string {
  return `service-${randomUUID()}`;
}

export async function saveInternalBusinessWorkspace(
  input: SaveInternalBusinessWorkspaceInput,
  userId: string,
): Promise<InternalBusinessWorkspace> {
  await withTransaction(async (client) => {
    await saveProfile(client, input.profile, userId);
    for (const service of input.services) {
      const id = service.id ?? newServiceId();
      await client.query(
        `INSERT INTO internal_business_services (
           id, name, description, price, billing_type, allow_two_payments,
           second_payment_trigger, active, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           price = EXCLUDED.price, billing_type = EXCLUDED.billing_type,
           allow_two_payments = EXCLUDED.allow_two_payments,
           second_payment_trigger = EXCLUDED.second_payment_trigger,
           active = EXCLUDED.active, sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
        [
          id, service.name, service.description, service.price, service.billingType,
          service.allowTwoPayments, service.secondPaymentTrigger, service.active, service.sortOrder,
        ],
      );
    }
  });
  return getInternalBusinessWorkspace();
}
