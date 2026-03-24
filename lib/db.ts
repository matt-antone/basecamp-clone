import { Pool, type QueryResultRow } from "pg";
import { config } from "./config";

const globalForPg = globalThis as unknown as { pool?: Pool };

function getPool() {
  if (globalForPg.pool) {
    return globalForPg.pool;
  }

  const pool = new Pool({
    connectionString: config.databaseUrl()
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPg.pool = pool;
  }

  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}
