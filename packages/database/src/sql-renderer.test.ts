import { describe, it, expect } from 'vitest'

import { renderSql } from './sql-renderer.js'
import { QueryBuilder } from './query-builder.js'
import { RawExpr } from './expr.js'

describe('renderSql', () => {
  describe('SELECT', () => {
    it('renders basic select', () => {
      const plan = new QueryBuilder('users').toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users"')
      expect(params).toEqual([])
    })

    it('renders select with columns', () => {
      const plan = new QueryBuilder('users').select('id', 'email').toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT "id", "email" FROM "users"')
      expect(params).toEqual([])
    })

    it('renders where with dollar placeholders', () => {
      const plan = new QueryBuilder('users').where({ email: 'matt@test.com' }).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE "email" = $1')
      expect(params).toEqual(['matt@test.com'])
    })

    it('renders where with question placeholders', () => {
      const plan = new QueryBuilder('users').where({ email: 'matt@test.com' }).toPlan()
      const [sql, params] = renderSql(plan, 'question')
      expect(sql).toBe('SELECT * FROM "users" WHERE "email" = ?')
      expect(params).toEqual(['matt@test.com'])
    })

    it('renders multiple where conditions as AND', () => {
      const plan = new QueryBuilder('users')
        .where({ role: 'admin' })
        .where('age', '>', 18)
        .toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "age" > $2')
      expect(params).toEqual(['admin', 18])
    })

    it('renders IN clause', () => {
      const plan = new QueryBuilder('users').where('status', 'in', ['active', 'pending']).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE "status" IN ($1, $2)')
      expect(params).toEqual(['active', 'pending'])
    })

    it('renders IS NULL', () => {
      const plan = new QueryBuilder('users').where('deletedAt', 'is', null).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE "deletedAt" IS NULL')
      expect(params).toEqual([])
    })

    it('renders IS NOT NULL', () => {
      const plan = new QueryBuilder('users').where('deletedAt', 'is not', null).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL')
      expect(params).toEqual([])
    })

    it('renders OR conditions', () => {
      const plan = new QueryBuilder('users')
        .whereOr([{ status: 'active' }, { role: 'admin' }])
        .toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "users" WHERE ("status" = $1 OR "role" = $2)')
      expect(params).toEqual(['active', 'admin'])
    })

    it('renders ORDER BY, LIMIT, OFFSET', () => {
      const plan = new QueryBuilder('posts').orderBy('date', 'desc').limit(10).offset(20).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT * FROM "posts" ORDER BY "date" DESC LIMIT 10 OFFSET 20')
      expect(params).toEqual([])
    })
  })

  describe('INSERT', () => {
    it('renders single insert', () => {
      const plan = new QueryBuilder('users').insert({ name: 'Matt', email: 'matt@test.com' }).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('INSERT INTO "users" ("name", "email") VALUES ($1, $2)')
      expect(params).toEqual(['Matt', 'matt@test.com'])
    })

    it('renders bulk insert', () => {
      const plan = new QueryBuilder('tags').insert([{ name: 'a' }, { name: 'b' }]).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('INSERT INTO "tags" ("name") VALUES ($1), ($2)')
      expect(params).toEqual(['a', 'b'])
    })

    it('renders insert with RETURNING', () => {
      const plan = new QueryBuilder('users').insert({ name: 'Matt' }).returning('id', 'name').toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('INSERT INTO "users" ("name") VALUES ($1) RETURNING "id", "name"')
      expect(params).toEqual(['Matt'])
    })
  })

  describe('UPDATE', () => {
    it('renders update with where', () => {
      const plan = new QueryBuilder('users').where({ id: 1 }).update({ name: 'New' }).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('UPDATE "users" SET "name" = $1 WHERE "id" = $2')
      expect(params).toEqual(['New', 1])
    })

    it('renders update with RawExpr', () => {
      const plan = new QueryBuilder('accounts')
        .where({ id: 1 })
        .update({ balance: new RawExpr('balance - ?', [50]) })
        .toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('UPDATE "accounts" SET "balance" = balance - $1 WHERE "id" = $2')
      expect(params).toEqual([50, 1])
    })
  })

  describe('DELETE', () => {
    it('renders delete with where', () => {
      const plan = new QueryBuilder('sessions').where('token', '=', 'abc').delete().toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('DELETE FROM "sessions" WHERE "token" = $1')
      expect(params).toEqual(['abc'])
    })
  })

  describe('COUNT', () => {
    it('renders count', () => {
      const plan = new QueryBuilder('posts').count().toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT COUNT(*) AS "count" FROM "posts"')
      expect(params).toEqual([])
    })

    it('renders count with where', () => {
      const plan = new QueryBuilder('posts').where({ draft: false }).count().toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).toBe('SELECT COUNT(*) AS "count" FROM "posts" WHERE "draft" = $1')
      expect(params).toEqual([false])
    })
  })

  describe('security', () => {
    it('never concatenates values into SQL', () => {
      const plan = new QueryBuilder('users').where({ name: "'; DROP TABLE users; --" }).toPlan()
      const [sql, params] = renderSql(plan, 'dollar')
      expect(sql).not.toContain('DROP TABLE')
      expect(sql).toBe('SELECT * FROM "users" WHERE "name" = $1')
      expect(params).toEqual(["'; DROP TABLE users; --"])
    })
  })
})
