import { describe, it, expect } from 'vitest'
import { createSqliteAdapter } from './sqlite.js'

describe('sqliteAdapter', () => {
  it('returns adapter with correct dialect', () => {
    const adapter = createSqliteAdapter({ filename: ':memory:' })
    expect(adapter.dialect).toBe('sqlite')
  })

  it('can connect, execute, and disconnect with in-memory db', async () => {
    const adapter = createSqliteAdapter({ filename: ':memory:' })
    await adapter.connect()
    const result = await adapter.execute('SELECT 1 + 1 AS sum', [])
    expect(result.rows).toEqual([{ sum: 2 }])
    await adapter.disconnect()
  })

  it('supports transactions (commit)', async () => {
    const adapter = createSqliteAdapter({ filename: ':memory:' })
    await adapter.connect()
    await adapter.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)', [])

    const tx = await adapter.beginTransaction()
    await adapter.executeInTransaction(tx, 'INSERT INTO test (name) VALUES (?)', ['Alice'])
    await adapter.commitTransaction(tx)

    const result = await adapter.execute('SELECT * FROM test', [])
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }])
    await adapter.disconnect()
  })

  it('supports transactions (rollback)', async () => {
    const adapter = createSqliteAdapter({ filename: ':memory:' })
    await adapter.connect()
    await adapter.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)', [])

    const tx = await adapter.beginTransaction()
    await adapter.executeInTransaction(tx, 'INSERT INTO test (name) VALUES (?)', ['Bob'])
    await adapter.rollbackTransaction(tx)

    const result = await adapter.execute('SELECT * FROM test', [])
    expect(result.rows).toEqual([])
    await adapter.disconnect()
  })
})
