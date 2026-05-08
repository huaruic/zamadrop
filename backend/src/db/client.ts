import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function shutdown() {
  await pool.end();
}
