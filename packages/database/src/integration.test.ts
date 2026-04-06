import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { createDatabase } from './index.js'
import { createSqliteAdapter } from './adapters/sqlite.js'
import type { Database } from './database.js'

describe('integration: SQLite', () => {
  let db: Database

  beforeEach(async () => {
    db = createDatabase(createSqliteAdapter({ filename: ':memory:' }))
    await db.connect()
    await db.raw('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, age INTEGER)', [])
  })

  afterEach(async () => {
    await db.disconnect()
  })

  it('inserts and queries rows', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'matt@test.com', age: 30 })
    await db.query('users').insert({ name: 'Alice', email: 'alice@test.com', age: 25 })
    const all = await db.query('users').all()
    expect(all).toHaveLength(2)
    const matt = await db.query('users').where({ name: 'Matt' }).first()
    expect(matt).not.toBeNull()
    expect(matt!.email).toBe('matt@test.com')
  })

  it('updates rows', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'old@test.com', age: 30 })
    await db.query('users').where({ name: 'Matt' }).update({ email: 'new@test.com' })
    const matt = await db.query('users').where({ name: 'Matt' }).first()
    expect(matt!.email).toBe('new@test.com')
  })

  it('deletes rows', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'matt@test.com', age: 30 })
    await db.query('users').where({ name: 'Matt' }).delete()
    const all = await db.query('users').all()
    expect(all).toHaveLength(0)
  })

  it('counts rows', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'matt@test.com', age: 30 })
    await db.query('users').insert({ name: 'Alice', email: 'alice@test.com', age: 25 })
    const count = await db.query('users').count()
    expect(count).toBe(2)
  })

  it('filters with operators', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'matt@test.com', age: 30 })
    await db.query('users').insert({ name: 'Alice', email: 'alice@test.com', age: 25 })
    await db.query('users').insert({ name: 'Bob', email: 'bob@test.com', age: 35 })
    const result = await db.query('users').where('age', '>', 28).all()
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.name).sort()).toEqual(['Bob', 'Matt'])
  })

  it('orders and limits results', async () => {
    await db.query('users').insert({ name: 'Matt', email: 'matt@test.com', age: 30 })
    await db.query('users').insert({ name: 'Alice', email: 'alice@test.com', age: 25 })
    await db.query('users').insert({ name: 'Bob', email: 'bob@test.com', age: 35 })
    const result = await db.query('users').orderBy('age', 'desc').limit(2).all()
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Bob')
    expect(result[1].name).toBe('Matt')
  })

  it('runs migrations', async () => {
    await db.migrate([{
      name: '001_create_sessions',
      up: 'CREATE TABLE sessions (id INTEGER PRIMARY KEY, token TEXT UNIQUE)',
      down: 'DROP TABLE sessions',
    }])
    await db.query('sessions').insert({ token: 'abc123' })
    const row = await db.query('sessions').where({ token: 'abc123' }).first()
    expect(row).not.toBeNull()
    // running again should skip (not error)
    await db.migrate([{
      name: '001_create_sessions',
      up: 'CREATE TABLE sessions (id INTEGER PRIMARY KEY, token TEXT UNIQUE)',
      down: 'DROP TABLE sessions',
    }])
  })

  it('handles transactions (commit)', async () => {
    await db.transaction(async (tx) => {
      await tx.query('users').insert({ name: 'TxUser', email: 'tx@test.com', age: 20 })
    })
    const row = await db.query('users').where({ name: 'TxUser' }).first()
    expect(row).not.toBeNull()
  })

  it('handles transactions (rollback)', async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.query('users').insert({ name: 'RollbackUser', email: 'rb@test.com', age: 20 })
        throw new Error('force rollback')
      })
    } catch {}
    const row = await db.query('users').where({ name: 'RollbackUser' }).first()
    expect(row).toBeNull()
  })

  it('prevents SQL injection via parameterized values', async () => {
    const malicious = "'; DROP TABLE users; --"
    await db.query('users').insert({ name: malicious, email: 'hack@test.com', age: 1 })
    const all = await db.query('users').all()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe(malicious)
    const count = await db.query('users').count()
    expect(count).toBe(1)
  })

  it('rejects SQL injection via identifiers', () => {
    expect(() => db.query('users; DROP TABLE users')).toThrow()
  })
})
