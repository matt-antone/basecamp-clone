import { Pool, type QueryResultRow } from "pg";
import { config } from "./config";

const globalForPg = globalThis as unknown as { pool?: Pool };

function getPool() {
  if (globalForPg.pool) {
    return globalForPg.pool;
  }

  const pool = new Pool({
    connectionString: config.databaseUrl(),
    max: 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000
  });

  globalForPg.pool = pool;

  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}
