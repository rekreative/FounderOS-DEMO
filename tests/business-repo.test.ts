import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SaveInternalBusinessWorkspaceInput } from '@/lib/business';
import { getInternalBusinessWorkspace, saveInternalBusinessWorkspace } from '@/lib/server/business-repo';
import { closePool, query } from '@/lib/server/db';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

const profile: SaveInternalBusinessWorkspaceInput['profile'] = {
  displayName: 'REKREATIVE Test',
  description: 'Disposable database fixture.',
  ownerName: 'Test operator',
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  monthlyRevenueTarget: 10_000,
  monthlyNewClientsMin: 6,
  monthlyNewClientsTarget: 7,
  monthlyNewClientsMax: 8,
  monthlyLeadsMin: 50,
  monthlyLeadsTarget: 60,
  monthlyLeadsMax: 70,
  monthlyAppointmentsTarget: 20,
  acquisitionChannels: ['Meta Ads'],
  tools: ['Make'],
  commercialPolicy: 'Test policy.',
};

describe.runIf(Boolean(TEST_DATABASE_URL))('internal business repository (real PostgreSQL)', () => {
  const testUserId = randomUUID();

  beforeAll(async () => {
    await query('INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES ($1, false, false)', [testUserId]);
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [testUserId, 'internal']);
    await query('DELETE FROM internal_business_services');
    await query('DELETE FROM internal_business_profile');
  });

  afterAll(async () => {
    await query('DELETE FROM internal_business_services');
    await query('DELETE FROM internal_business_profile');
    await query('DELETE FROM profiles WHERE user_id = $1', [testUserId]);
    await query('DELETE FROM auth.users WHERE id = $1', [testUserId]);
    await closePool();
  });

  it('starts honestly empty when the operator has not configured the workspace', async () => {
    await expect(getInternalBusinessWorkspace()).resolves.toEqual({ profile: null, services: [] });
  });

  it('atomically saves and reads the profile plus ordered service catalogue', async () => {
    const workspace = await saveInternalBusinessWorkspace(
      {
        profile,
        services: [
          {
            name: 'Meta Ads',
            description: 'Campaign implementation.',
            price: 600,
            billingType: 'one_off',
            allowTwoPayments: true,
            secondPaymentTrigger: 'Second payment at launch.',
            active: true,
            sortOrder: 0,
          },
          {
            name: 'Maintenance',
            description: null,
            price: 120,
            billingType: 'monthly',
            allowTwoPayments: false,
            secondPaymentTrigger: null,
            active: true,
            sortOrder: 1,
          },
        ],
      },
      testUserId,
    );

    expect(workspace.profile).toMatchObject({ displayName: 'REKREATIVE Test', monthlyRevenueTarget: 10_000 });
    expect(workspace.services.map((service) => service.name)).toEqual(['Meta Ads', 'Maintenance']);
    expect(workspace.services[0].id).toMatch(/^service-[0-9a-f-]{36}$/);
  });

  it('rolls back the whole aggregate when any service violates a database invariant', async () => {
    const invalidInput = {
      profile: { ...profile, displayName: 'MUST ROLL BACK' },
      services: [
        {
          name: 'Invalid monthly split',
          description: null,
          price: 300,
          billingType: 'monthly',
          allowTwoPayments: true,
          secondPaymentTrigger: 'Invalid trigger',
          active: true,
          sortOrder: 0,
        },
      ],
    } as unknown as SaveInternalBusinessWorkspaceInput;

    await expect(saveInternalBusinessWorkspace(invalidInput, testUserId)).rejects.toBeTruthy();
    const workspace = await getInternalBusinessWorkspace();
    expect(workspace.profile?.displayName).toBe('REKREATIVE Test');
    expect(workspace.services.some((service) => service.name === 'Invalid monthly split')).toBe(false);
  });

  it('has RLS enabled and no direct-access policies on both tables', async () => {
    const result = await query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname = ANY($1)
       ORDER BY relname`,
      [['internal_business_profile', 'internal_business_services']],
    );
    expect(result.rows).toEqual([
      { relname: 'internal_business_profile', relrowsecurity: true },
      { relname: 'internal_business_services', relrowsecurity: true },
    ]);
    const policies = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policies WHERE tablename = ANY($1)`,
      [['internal_business_profile', 'internal_business_services']],
    );
    expect(policies.rows[0].count).toBe('0');
  });
});
