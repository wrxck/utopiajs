import type { DatabaseAdapter, SqlMigration } from './types.js'

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" VARCHAR(255) PRIMARY KEY,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now()
)`

const SELECT_APPLIED = `SELECT "name" FROM "_migrations" ORDER BY "name"`

const INSERT_MIGRATION = `INSERT INTO "_migrations" ("name") VALUES ($1)`

export async function runSqlMigrations(adapter: DatabaseAdapter, migrations: SqlMigration[]): Promise<void> {
  await adapter.execute(CREATE_MIGRATIONS_TABLE, [])
  const result = await adapter.execute(SELECT_APPLIED, [])
  const applied = new Set(result.rows.map((r) => r.name as string))

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue

    const tx = await adapter.beginTransaction()
    try {
      await adapter.executeInTransaction(tx, migration.up, [])
      await adapter.executeInTransaction(tx, INSERT_MIGRATION, [migration.name])
      await adapter.commitTransaction(tx)
    } catch (err) {
      await adapter.rollbackTransaction(tx)
      throw err
    }
  }
}
