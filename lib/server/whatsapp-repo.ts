import type { PoolClient } from 'pg';
import { query } from './db';

export type WhatsAppOwnerScope = 'internal' | 'client';

export type WhatsAppBusinessNumber = {
  id: string;
  ownerScope: WhatsAppOwnerScope;
  clientId: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  label: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWhatsAppBusinessNumberInput = {
  ownerScope: WhatsAppOwnerScope;
  clientId?: string | null;
  phoneNumberId: string;
  wabaId?: string | null;
  displayPhoneNumber?: string | null;
  label?: string | null;
  validFrom?: string;
  validTo?: string | null;
};

export type UpdateWhatsAppBusinessNumberInput = Partial<{
  wabaId: string | null;
  displayPhoneNumber: string | null;
  label: string | null;
  validTo: string | null;
}>;

type WhatsAppBusinessNumberRow = {
  id: string;
  owner_scope: string;
  client_id: string | null;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  label: string | null;
  valid_from: Date;
  valid_to: Date | null;
  created_at: Date;
  updated_at: Date;
};

function generateId(): string {
  return `whatsapp-number-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function rowToBusinessNumber(row: WhatsAppBusinessNumberRow): WhatsAppBusinessNumber {
  return {
    id: row.id,
    ownerScope: row.owner_scope as WhatsAppOwnerScope,
    clientId: row.client_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhoneNumber: row.display_phone_number,
    label: row.label,
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to ? row.valid_to.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createWhatsAppBusinessNumber(
  input: CreateWhatsAppBusinessNumberInput,
): Promise<WhatsAppBusinessNumber> {
  const result = await query<WhatsAppBusinessNumberRow>(
    `INSERT INTO whatsapp_business_numbers (
       id, owner_scope, client_id, phone_number_id, waba_id,
       display_phone_number, label, valid_from, valid_to
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9::timestamptz)
     RETURNING *`,
    [
      generateId(),
      input.ownerScope,
      input.clientId ?? null,
      input.phoneNumberId.trim(),
      nullableTrim(input.wabaId),
      nullableTrim(input.displayPhoneNumber),
      nullableTrim(input.label),
      input.validFrom ?? null,
      input.validTo ?? null,
    ],
  );
  return rowToBusinessNumber(result.rows[0]);
}

export async function getWhatsAppBusinessNumberById(id: string): Promise<WhatsAppBusinessNumber | null> {
  const result = await query<WhatsAppBusinessNumberRow>('SELECT * FROM whatsapp_business_numbers WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToBusinessNumber(result.rows[0]);
}

export async function resolveWhatsAppBusinessNumberOnClient(
  client: PoolClient,
  phoneNumberId: string,
  occurredAt: Date,
): Promise<WhatsAppBusinessNumber | null> {
  const result = await client.query<WhatsAppBusinessNumberRow>(
    `SELECT * FROM whatsapp_business_numbers
     WHERE phone_number_id = $1
       AND $2::timestamptz >= valid_from
       AND (valid_to IS NULL OR $2::timestamptz < valid_to)`,
    [phoneNumberId.trim(), occurredAt],
  );
  return result.rowCount === 0 ? null : rowToBusinessNumber(result.rows[0]);
}

export async function resolveWhatsAppBusinessNumber(
  phoneNumberId: string,
  occurredAt: Date,
): Promise<WhatsAppBusinessNumber | null> {
  const result = await query<WhatsAppBusinessNumberRow>(
    `SELECT * FROM whatsapp_business_numbers
     WHERE phone_number_id = $1
       AND $2::timestamptz >= valid_from
       AND (valid_to IS NULL OR $2::timestamptz < valid_to)`,
    [phoneNumberId.trim(), occurredAt],
  );
  return result.rowCount === 0 ? null : rowToBusinessNumber(result.rows[0]);
}

export async function listWhatsAppBusinessNumbers(options: {
  ownerScope?: WhatsAppOwnerScope;
  clientId?: string;
} = {}): Promise<WhatsAppBusinessNumber[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.ownerScope) {
    params.push(options.ownerScope);
    conditions.push(`owner_scope = $${params.length}`);
  }
  if (options.clientId) {
    params.push(options.clientId);
    conditions.push(`client_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<WhatsAppBusinessNumberRow>(
    `SELECT * FROM whatsapp_business_numbers ${where} ORDER BY created_at DESC`,
    params,
  );
  return result.rows.map(rowToBusinessNumber);
}

export async function updateWhatsAppBusinessNumber(
  id: string,
  patch: UpdateWhatsAppBusinessNumberInput,
): Promise<WhatsAppBusinessNumber | null> {
  const fields: Array<{
    key: keyof UpdateWhatsAppBusinessNumberInput;
    column: string;
    toDb: (value: unknown) => unknown;
  }> = [
    { key: 'wabaId', column: 'waba_id', toDb: (value) => nullableTrim(value as string | null) },
    { key: 'displayPhoneNumber', column: 'display_phone_number', toDb: (value) => nullableTrim(value as string | null) },
    { key: 'label', column: 'label', toDb: (value) => nullableTrim(value as string | null) },
    { key: 'validTo', column: 'valid_to', toDb: (value) => value ?? null },
  ];
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const field of fields) {
    if (!(field.key in patch)) continue;
    values.push(field.toDb(patch[field.key]));
    clauses.push(`${field.column} = $${values.length}`);
  }
  if (clauses.length === 0) return getWhatsAppBusinessNumberById(id);
  values.push(id);
  const result = await query<WhatsAppBusinessNumberRow>(
    `UPDATE whatsapp_business_numbers
     SET ${clauses.join(', ')}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToBusinessNumber(result.rows[0]);
}
