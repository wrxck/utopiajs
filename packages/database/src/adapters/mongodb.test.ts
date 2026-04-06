import { describe, it, expect } from 'vitest'

import { createMongoAdapter } from './mongodb.js'

describe('createMongoAdapter', () => {
  it('returns adapter with dialect mongodb', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(adapter.dialect).toBe('mongodb')
  })

  it('throws on raw SQL execute()', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(() => adapter.execute('SELECT 1', [])).toThrow(
      '@matthesketh/utopia-database: execute() is not supported for MongoDB'
    )
  })

  it('throws on beginTransaction()', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(() => adapter.beginTransaction()).toThrow(
      '@matthesketh/utopia-database: transactions are not yet supported for MongoDB'
    )
  })

  it('throws on commitTransaction()', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(() => adapter.commitTransaction({ id: 'x' })).toThrow(
      '@matthesketh/utopia-database: transactions are not yet supported for MongoDB'
    )
  })

  it('throws on rollbackTransaction()', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(() => adapter.rollbackTransaction({ id: 'x' })).toThrow(
      '@matthesketh/utopia-database: transactions are not yet supported for MongoDB'
    )
  })

  it('returns null from native() before connect', () => {
    const adapter = createMongoAdapter({ uri: 'mongodb://localhost:27017', database: 'test' })
    expect(adapter.native()).toBeNull()
  })
})
