import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { DB } from "./db-types";
import { env } from "./env";

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: env.databaseUrl }),
  }),
});

export async function dbHealthy(): Promise<boolean> {
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
