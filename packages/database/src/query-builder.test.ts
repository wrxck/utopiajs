import { describe, it, expect } from 'vitest'

import { QueryBuilder } from './query-builder.js'
import { RawExpr } from './expr.js'

function qb(table: string) {
  return new QueryBuilder(table)
}

describe('QueryBuilder', () => {
  describe('select', () => {
    it('builds a basic select plan', () => {
      const plan = qb('users').select('id', 'email').toPlan()
      expect(plan.operation).toBe('select')
      expect(plan.table).toBe('users')
      expect(plan.columns).toEqual(['id', 'email'])
    })

    it('defaults to all columns', () => {
      const plan = qb('users').toPlan()
      expect(plan.operation).toBe('select')
      expect(plan.columns).toBeUndefined()
    })
  })

  describe('where', () => {
    it('handles object shorthand (equals)', () => {
      const plan = qb('users').where({ email: 'matt@test.com', role: 'admin' }).toPlan()
      expect(plan.conditions).toEqual([
        { column: 'email', operator: '=', value: 'matt@test.com' },
        { column: 'role', operator: '=', value: 'admin' },
      ])
    })

    it('handles operator form', () => {
      const plan = qb('posts').where('views', '>', 100).toPlan()
      expect(plan.conditions).toEqual([
        { column: 'views', operator: '>', value: 100 },
      ])
    })

    it('handles in operator', () => {
      const plan = qb('users').where('status', 'in', ['active', 'pending']).toPlan()
      expect(plan.conditions).toEqual([
        { column: 'status', operator: 'in', value: ['active', 'pending'] },
      ])
    })

    it('handles is null', () => {
      const plan = qb('users').where('deletedAt', 'is', null).toPlan()
      expect(plan.conditions).toEqual([
        { column: 'deletedAt', operator: 'is', value: null },
      ])
    })

    it('chains conditions as AND', () => {
      const plan = qb('users').where({ role: 'admin' }).where('age', '>', 18).toPlan()
      expect(plan.conditions).toHaveLength(2)
    })

    it('rejects invalid operators', () => {
      expect(() => qb('users').where('id', 'DROP TABLE' as unknown as string, 1)).toThrow()
    })

    it('rejects invalid column names', () => {
      expect(() => qb('users').where('id; DROP TABLE users', '=', 1)).toThrow()
    })
  })

  describe('whereOr', () => {
    it('builds OR condition groups', () => {
      const plan = qb('users').whereOr([
        { status: 'active' },
        { role: 'admin' },
      ]).toPlan()
      expect(plan.orConditions).toEqual([
        [{ column: 'status', operator: '=', value: 'active' }],
        [{ column: 'role', operator: '=', value: 'admin' }],
      ])
    })
  })

  describe('insert', () => {
    it('builds single insert plan', () => {
      const plan = qb('users').insert({ name: 'Matt', email: 'matt@test.com' }).toPlan()
      expect(plan.operation).toBe('insert')
      expect(plan.values).toEqual([{ name: 'Matt', email: 'matt@test.com' }])
    })

    it('builds bulk insert plan', () => {
      const plan = qb('tags').insert([{ name: 'a' }, { name: 'b' }]).toPlan()
      expect(plan.operation).toBe('insert')
      expect(plan.values).toHaveLength(2)
    })

    it('validates column names in values', () => {
      expect(() => qb('users').insert({ 'bad; col': 'val' })).toThrow()
    })
  })

  describe('update', () => {
    it('builds update plan', () => {
      const plan = qb('users').where({ id: 1 }).update({ name: 'New' }).toPlan()
      expect(plan.operation).toBe('update')
      expect(plan.values).toEqual([{ name: 'New' }])
    })

    it('handles RawExpr in values', () => {
      const plan = qb('accounts')
        .where({ id: 1 })
        .update({ balance: new RawExpr('balance - ?', [50]) })
        .toPlan()
      expect(plan.operation).toBe('update')
      expect(plan.values![0].balance).toBeInstanceOf(RawExpr)
    })
  })

  describe('delete', () => {
    it('builds delete plan', () => {
      const plan = qb('sessions').where('expiresAt', '<', new Date('2025-01-01')).delete().toPlan()
      expect(plan.operation).toBe('delete')
      expect(plan.conditions).toHaveLength(1)
    })
  })

  describe('returning', () => {
    it('sets returning columns', () => {
      const plan = qb('users').insert({ name: 'Matt' }).returning('id', 'name').toPlan()
      expect(plan.returning).toEqual(['id', 'name'])
    })
  })

  describe('orderBy / limit / offset', () => {
    it('sets order, limit, and offset', () => {
      const plan = qb('posts').orderBy('date', 'desc').limit(10).offset(20).toPlan()
      expect(plan.orderBy).toEqual({ column: 'date', direction: 'desc' })
      expect(plan.limit).toBe(10)
      expect(plan.offset).toBe(20)
    })

    it('rejects invalid sort direction', () => {
      expect(() => qb('posts').orderBy('date', 'DROP TABLE' as unknown as 'asc' | 'desc')).toThrow()
    })
  })

  describe('count', () => {
    it('sets count operation', () => {
      const plan = qb('posts').count().toPlan()
      expect(plan.operation).toBe('count')
    })
  })

  describe('table validation', () => {
    it('rejects invalid table names', () => {
      expect(() => qb('users; DROP TABLE users')).toThrow()
    })
  })
})
