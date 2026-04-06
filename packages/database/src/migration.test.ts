import { describe, it, expect } from 'vitest'

import { runSqlMigrations } from './migration.js'
import type { DatabaseAdapter, QueryResult, TransactionHandle } from './types.js'

function mockAdapter(appliedMigrations: string[] = []) {
  const executed: Array<{ sql: string; params: unknown[] }> = []

  const adapter = {
    dialect: 'postgres' as const,
    async connect() {},
    async disconnect() {},
    async execute(sql: string, params: unknown[]): Promise<QueryResult> {
      executed.push({ sql, params })
      if (sql.includes('SELECT "name" FROM "_migrations"')) {
        return { rows: appliedMigrations.map((n) => ({ name: n })), rowCount: appliedMigrations.length }
      }
      return { rows: [], rowCount: 0 }
    },
    async beginTransaction() { return { id: 'tx-1' } },
    async commitTransaction() {},
    async rollbackTransaction() {},
    async executeInTransaction(_h: TransactionHandle, sql: string, params: unknown[]): Promise<QueryResult> {
      executed.push({ sql, params })
      return { rows: [], rowCount: 0 }
    },
    native() { return null },
    get _executed() { return executed },
  }
  return adapter as DatabaseAdapter & { _executed: typeof executed }
}

describe('runSqlMigrations', () => {
  it('creates _migrations table and applies new migrations', async () => {
    const adapter = mockAdapter([])
    await runSqlMigrations(adapter, [
      { name: '001_init', up: 'CREATE TABLE users (id SERIAL)', down: 'DROP TABLE users' },
    ])
    const sqls = adapter._executed.map((e) => e.sql)
    expect(sqls).toContain('CREATE TABLE users (id SERIAL)')
  })

  it('skips already-applied migrations', async () => {
    const adapter = mockAdapter(['001_init'])
    await runSqlMigrations(adapter, [
      { name: '001_init', up: 'CREATE TABLE users (id SERIAL)', down: 'DROP TABLE users' },
      { name: '002_add_email', up: 'ALTER TABLE users ADD email TEXT', down: 'ALTER TABLE users DROP email' },
    ])
    const sqls = adapter._executed.map((e) => e.sql)
    expect(sqls).not.toContain('CREATE TABLE users (id SERIAL)')
    expect(sqls).toContain('ALTER TABLE users ADD email TEXT')
  })

  it('records applied migrations', async () => {
    const adapter = mockAdapter([])
    await runSqlMigrations(adapter, [
      { name: '001_init', up: 'CREATE TABLE test (id INT)', down: 'DROP TABLE test' },
    ])
    const inserts = adapter._executed.filter((e) => e.sql.includes('INSERT INTO "_migrations"'))
    expect(inserts).toHaveLength(1)
    expect(inserts[0].params).toEqual(['001_init'])
  })
})
