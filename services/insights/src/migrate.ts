// Applies services/insights/migrations/V3xx__*.sql in order, once each, inside schema
// `insights`. Zone A's Flyway owns `public`; keeping our own history table means the two
// zones never fight over migration state.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

const FILE_PATTERN = /^V3\d{2}__[\w-]+\.sql$/;

export async function migrate(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS insights.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const done = await pool.query("SELECT 1 FROM insights.schema_migrations WHERE version = $1", [file]);
    if (done.rowCount) continue;
    const sql = await readFile(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO insights, public");
      await client.query(sql);
      await client.query("INSERT INTO insights.schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}
