export const SERVER_DEMO_DATA_FLAG = 'FOUNDER_OS_SEED_DEMO_DATA';

export function isServerDemoDataEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[SERVER_DEMO_DATA_FLAG] !== 'false';
}

export function isBrowserDemoDataEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA !== 'false';
}

export function withoutDemoRecords<T extends { dataSource?: string }>(records: T[]): T[] {
  return records.filter((record) => record.dataSource !== 'demo');
}
