import { describe, it, expect, vi, beforeEach } from 'vitest'

import { Database } from './database.js'
import { RawExpr } from './expr.js'
import type { DatabaseAdapter, QueryResult, TransactionHandle } from './types.js'

function makeResult(rows: Record<string, unknown>[] = [], rowCount?: number): QueryResult {
  return { rows, rowCount: rowCount ?? rows.length }
}

function makeMockAdapter(dialect: 'postgres' | 'mysql' | 'sqlite' = 'postgres'): DatabaseAdapter & {
  execute: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  beginTransaction: ReturnType<typeof vi.fn>
  commitTransaction: ReturnType<typeof vi.fn>
  rollbackTransaction: ReturnType<typeof vi.fn>
  executeInTransaction: ReturnType<typeof vi.fn>
  native: ReturnType<typeof vi.fn>
} {
  return {
    dialect,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(makeResult()),
    beginTransaction: vi.fn().mockResolvedValue({ id: 'tx-1' } as TransactionHandle),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    executeInTransaction: vi.fn().mockResolvedValue(makeResult()),
    native: vi.fn().mockReturnValue({ client: 'mock' }),
  }
}

describe('Database', () => {
  let adapter: ReturnType<typeof makeMockAdapter>
  let db: Database

  beforeEach(() => {
    adapter = makeMockAdapter()
    db = new Database(adapter)
  })

  it('connect delegates to adapter', async () => {
    await db.connect()
    expect(adapter.connect).toHaveBeenCalledOnce()
  })

  it('disconnect delegates to adapter', async () => {
    await db.disconnect()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })

  describe('query().where().all()', () => {
    it('renders SQL and passes to adapter.execute', async () => {
      adapter.execute.mockResolvedValue(makeResult([{ id: 1, name: 'Alice' }]))
      const rows = await db.query('users').where('id', '=', 1).all()

      expect(adapter.execute).toHaveBeenCalledOnce()
      const [sql, params] = adapter.execute.mock.calls[0]
      expect(sql).toBe('SELECT * FROM "users" WHERE "id" = $1')
      expect(params).toEqual([1])
      expect(rows).toEqual([{ id: 1, name: 'Alice' }])
    })
  })

  describe('query().first()', () => {
    it('returns single row or null', async () => {
      adapter.execute.mockResolvedValue(makeResult([{ id: 2 }]))
      const row = await db.query('users').where('id', '=', 2).first()

      const [sql] = adapter.execute.mock.calls[0]
      expect(sql).toContain('LIMIT 1')
      expect(row).toEqual({ id: 2 })
    })

    it('returns null when no rows', async () => {
      adapter.execute.mockResolvedValue(makeResult([]))
      const row = await db.query('users').where('id', '=', 999).first()
      expect(row).toBeNull()
    })
  })

  describe('query().count()', () => {
    it('returns a number', async () => {
      adapter.execute.mockResolvedValue(makeResult([{ count: '42' }]))
      const n = await db.query('users').count()

      const [sql] = adapter.execute.mock.calls[0]
      expect(sql).toBe('SELECT COUNT(*) AS "count" FROM "users"')
      expect(n).toBe(42)
    })
  })

  describe('query().insert()', () => {
    it('executes insert via thenable', async () => {
      adapter.execute.mockResolvedValue(makeResult([], 1))
      const result = await db.query('users').insert({ name: 'Bob', age: 30 })

      const [sql, params] = adapter.execute.mock.calls[0]
      expect(sql).toContain('INSERT INTO "users"')
      expect(params).toContain('Bob')
      expect(params).toContain(30)
      expect(result.rowCount).toBe(1)
    })
  })

  describe('query().update()', () => {
    it('executes update via thenable', async () => {
      adapter.execute.mockResolvedValue(makeResult([], 1))
      await db.query('users').where('id', '=', 1).update({ name: 'Charlie' })

      const [sql, params] = adapter.execute.mock.calls[0]
      expect(sql).toContain('UPDATE "users" SET')
      expect(sql).toContain('WHERE "id" = $2')
      expect(params).toContain('Charlie')
      expect(params).toContain(1)
    })
  })

  describe('query().delete()', () => {
    it('executes delete via thenable', async () => {
      adapter.execute.mockResolvedValue(makeResult([], 1))
      await db.query('users').where('id', '=', 5).delete()

      const [sql, params] = adapter.execute.mock.calls[0]
      expect(sql).toBe('DELETE FROM "users" WHERE "id" = $1')
      expect(params).toEqual([5])
    })
  })

  describe('raw()', () => {
    it('passes SQL and params directly to adapter', async () => {
      adapter.execute.mockResolvedValue(makeResult([{ count: 3 }]))
      await db.raw('SELECT COUNT(*) FROM users WHERE active = $1', [true])

      expect(adapter.execute).toHaveBeenCalledWith('SELECT COUNT(*) FROM users WHERE active = $1', [true])
    })

    it('throws for mongodb adapters', () => {
      const mongoAdapter = { ...makeMockAdapter(), dialect: 'mongodb' as const }
      const mongoDb = new Database(mongoAdapter)
      expect(() => mongoDb.raw('SELECT 1')).toThrow(/not supported for MongoDB/)
    })
  })

  describe('expr()', () => {
    it('returns a RawExpr instance', () => {
      const expr = db.expr('NOW()')
      expect(expr).toBeInstanceOf(RawExpr)
      expect(expr.sql).toBe('NOW()')
      expect(expr.params).toEqual([])
    })

    it('passes params through', () => {
      const expr = db.expr('? + ?', [1, 2])
      expect(expr.params).toEqual([1, 2])
    })
  })

  describe('native()', () => {
    it('returns adapter.native()', () => {
      const n = db.native()
      expect(n).toEqual({ client: 'mock' })
      expect(adapter.native).toHaveBeenCalledOnce()
    })
  })

  describe('transaction()', () => {
    it('commits on success', async () => {
      adapter.executeInTransaction.mockResolvedValue(makeResult([{ id: 1 }]))

      const result = await db.transaction(async (tx) => {
        const rows = await tx.query('orders').where('user_id', '=', 1).all()
        return rows
      })

      expect(adapter.beginTransaction).toHaveBeenCalledOnce()
      expect(adapter.executeInTransaction).toHaveBeenCalledOnce()
      expect(adapter.commitTransaction).toHaveBeenCalledWith({ id: 'tx-1' })
      expect(adapter.rollbackTransaction).not.toHaveBeenCalled()
      expect(result).toEqual([{ id: 1 }])
    })

    it('rolls back on error', async () => {
      adapter.executeInTransaction.mockRejectedValue(new Error('DB error'))

      await expect(
        db.transaction(async (tx) => {
          await tx.query('orders').insert({ user_id: 1 })
        }),
      ).rejects.toThrow('DB error')

      expect(adapter.rollbackTransaction).toHaveBeenCalledWith({ id: 'tx-1' })
      expect(adapter.commitTransaction).not.toHaveBeenCalled()
    })
  })
})
