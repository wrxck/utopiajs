import { describe, it, expect } from 'vitest'

import { renderMongo } from './mongo-renderer.js'
import { QueryBuilder } from './query-builder.js'

describe('renderMongo', () => {
  describe('find', () => {
    it('renders a basic find with no filter', () => {
      const plan = new QueryBuilder('users').toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('find')
      expect(op.collection).toBe('users')
      expect(op.filter).toEqual({})
    })

    it('renders find with projection', () => {
      const plan = new QueryBuilder('users').select('id', 'email').toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('find')
      expect(op.projection).toEqual({ id: 1, email: 1 })
    })

    it('renders find with no projection when columns not set', () => {
      const plan = new QueryBuilder('users').toPlan()
      const op = renderMongo(plan)
      expect(op.projection).toBeUndefined()
    })

    it('renders equals filter', () => {
      const plan = new QueryBuilder('users').where({ status: 'active' }).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ status: 'active' })
    })

    it('renders != filter', () => {
      const plan = new QueryBuilder('users').where('role', '!=', 'guest').toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ role: { $ne: 'guest' } })
    })

    it('renders > filter', () => {
      const plan = new QueryBuilder('orders').where('total', '>', 100).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ total: { $gt: 100 } })
    })

    it('renders < filter', () => {
      const plan = new QueryBuilder('orders').where('total', '<', 50).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ total: { $lt: 50 } })
    })

    it('renders >= filter', () => {
      const plan = new QueryBuilder('products').where('stock', '>=', 10).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ stock: { $gte: 10 } })
    })

    it('renders <= filter', () => {
      const plan = new QueryBuilder('products').where('price', '<=', 999).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ price: { $lte: 999 } })
    })

    it('renders in filter', () => {
      const plan = new QueryBuilder('users').where('role', 'in', ['admin', 'mod']).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ role: { $in: ['admin', 'mod'] } })
    })

    it('renders not in filter', () => {
      const plan = new QueryBuilder('users').where('status', 'not in', ['banned', 'suspended']).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ status: { $nin: ['banned', 'suspended'] } })
    })

    it('renders is null filter', () => {
      const plan = new QueryBuilder('users').where('deletedAt', 'is', null).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ deletedAt: null })
    })

    it('renders is not null filter', () => {
      const plan = new QueryBuilder('users').where('verifiedAt', 'is not', null).toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ verifiedAt: { $ne: null } })
    })

    it('renders like filter', () => {
      const plan = new QueryBuilder('posts').where('title', 'like', '%hello%').toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ title: { $regex: '.*hello.*', $options: '' } })
    })

    it('renders like with prefix wildcard only', () => {
      const plan = new QueryBuilder('posts').where('slug', 'like', '%world').toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ slug: { $regex: '.*world', $options: '' } })
    })

    it('renders ilike filter (case-insensitive)', () => {
      const plan = new QueryBuilder('posts').where('title', 'ilike', '%hello%').toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({ title: { $regex: '.*hello.*', $options: 'i' } })
    })

    it('renders OR conditions', () => {
      const plan = new QueryBuilder('users')
        .whereOr([{ status: 'active' }, { role: 'admin' }])
        .toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({
        $or: [{ status: 'active' }, { role: 'admin' }],
      })
    })

    it('renders combined AND and OR conditions', () => {
      const plan = new QueryBuilder('users')
        .where({ verified: true })
        .whereOr([{ role: 'admin' }, { role: 'mod' }])
        .toPlan()
      const op = renderMongo(plan)
      expect(op.filter).toEqual({
        verified: true,
        $or: [{ role: 'admin' }, { role: 'mod' }],
      })
    })

    it('renders sort ascending', () => {
      const plan = new QueryBuilder('posts').orderBy('createdAt', 'asc').toPlan()
      const op = renderMongo(plan)
      expect(op.sort).toEqual({ createdAt: 1 })
    })

    it('renders sort descending', () => {
      const plan = new QueryBuilder('posts').orderBy('createdAt', 'desc').toPlan()
      const op = renderMongo(plan)
      expect(op.sort).toEqual({ createdAt: -1 })
    })

    it('renders limit', () => {
      const plan = new QueryBuilder('posts').limit(10).toPlan()
      const op = renderMongo(plan)
      expect(op.limit).toBe(10)
    })

    it('renders skip (offset)', () => {
      const plan = new QueryBuilder('posts').offset(20).toPlan()
      const op = renderMongo(plan)
      expect(op.skip).toBe(20)
    })

    it('renders limit and skip together', () => {
      const plan = new QueryBuilder('posts').limit(10).offset(30).toPlan()
      const op = renderMongo(plan)
      expect(op.limit).toBe(10)
      expect(op.skip).toBe(30)
    })
  })

  describe('countDocuments', () => {
    it('renders countDocuments', () => {
      const plan = new QueryBuilder('posts').count().toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('countDocuments')
      expect(op.collection).toBe('posts')
      expect(op.filter).toEqual({})
    })

    it('renders countDocuments with filter', () => {
      const plan = new QueryBuilder('posts').where({ published: true }).count().toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('countDocuments')
      expect(op.filter).toEqual({ published: true })
    })
  })

  describe('insertOne', () => {
    it('renders insertOne for a single document', () => {
      const plan = new QueryBuilder('users').insert({ name: 'Matt', email: 'matt@test.com' }).toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('insertOne')
      expect(op.collection).toBe('users')
      expect(op.documents).toEqual([{ name: 'Matt', email: 'matt@test.com' }])
    })
  })

  describe('insertMany', () => {
    it('renders insertMany for multiple documents', () => {
      const plan = new QueryBuilder('tags')
        .insert([{ name: 'typescript' }, { name: 'nodejs' }])
        .toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('insertMany')
      expect(op.documents).toEqual([{ name: 'typescript' }, { name: 'nodejs' }])
    })
  })

  describe('updateMany', () => {
    it('renders updateMany with $set', () => {
      const plan = new QueryBuilder('users')
        .where({ id: 42 })
        .update({ name: 'Updated', status: 'active' })
        .toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('updateMany')
      expect(op.collection).toBe('users')
      expect(op.filter).toEqual({ id: 42 })
      expect(op.update).toEqual({ $set: { name: 'Updated', status: 'active' } })
    })
  })

  describe('deleteMany', () => {
    it('renders deleteMany with filter', () => {
      const plan = new QueryBuilder('sessions').where('token', '=', 'abc123').delete().toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('deleteMany')
      expect(op.collection).toBe('sessions')
      expect(op.filter).toEqual({ token: 'abc123' })
    })

    it('renders deleteMany with no filter', () => {
      const plan = new QueryBuilder('sessions').delete().toPlan()
      const op = renderMongo(plan)
      expect(op.type).toBe('deleteMany')
      expect(op.filter).toEqual({})
    })
  })
})
