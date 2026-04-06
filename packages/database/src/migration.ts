import type { DatabaseAdapter, SqlMigration } from './types.js'

const CREATE_MIGRATIONS_TABLE_PG = `CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" VARCHAR(255) PRIMARY KEY,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now()
)`

const CREATE_MIGRATIONS_TABLE_GENERIC = `CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" VARCHAR(255) PRIMARY KEY,
  "applied_at" TEXT NOT NULL DEFAULT (datetime('now'))
)`

const SELECT_APPLIED = `SELECT "name" FROM "_migrations" ORDER BY "name"`

export async function runSqlMigrations(adapter: DatabaseAdapter, migrations: SqlMigration[]): Promise<void> {
  const isPostgres = adapter.dialect === 'postgres'
  const placeholder = isPostgres ? '$1' : '?'
  const createTable = isPostgres ? CREATE_MIGRATIONS_TABLE_PG : CREATE_MIGRATIONS_TABLE_GENERIC
  const insertMigration = `INSERT INTO "_migrations" ("name") VALUES (${placeholder})`

  await adapter.execute(createTable, [])
  const result = await adapter.execute(SELECT_APPLIED, [])
  const applied = new Set(result.rows.map((r) => r.name as string))

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue

    const tx = await adapter.beginTransaction()
    try {
      await adapter.executeInTransaction(tx, migration.up, [])
      await adapter.executeInTransaction(tx, insertMigration, [migration.name])
      await adapter.commitTransaction(tx)
    } catch (err) {
      await adapter.rollbackTransaction(tx)
      throw err
    }
  }
}
