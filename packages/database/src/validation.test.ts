import { describe, it, expect } from 'vitest'

import { validateIdentifier, validateOperator, validateSortDirection } from './validation.js'

describe('validateIdentifier', () => {
  it('accepts simple names', () => {
    expect(() => validateIdentifier('users')).not.toThrow()
    expect(() => validateIdentifier('user_id')).not.toThrow()
    expect(() => validateIdentifier('_private')).not.toThrow()
  })

  it('accepts dotted names', () => {
    expect(() => validateIdentifier('public.users')).not.toThrow()
    expect(() => validateIdentifier('schema.table.column')).not.toThrow()
  })

  it('rejects SQL injection attempts', () => {
    expect(() => validateIdentifier('users; DROP TABLE users')).toThrow()
    expect(() => validateIdentifier('users--')).toThrow()
    expect(() => validateIdentifier("users' OR '1'='1")).toThrow()
    expect(() => validateIdentifier('users/*')).toThrow()
    expect(() => validateIdentifier('')).toThrow()
    expect(() => validateIdentifier('123abc')).toThrow()
    expect(() => validateIdentifier('user name')).toThrow()
  })
})

describe('validateOperator', () => {
  it('accepts all allowed operators', () => {
    for (const op of ['=', '!=', '<', '>', '<=', '>=', 'in', 'not in', 'is', 'is not', 'like', 'ilike']) {
      expect(() => validateOperator(op)).not.toThrow()
    }
  })

  it('rejects invalid operators', () => {
    expect(() => validateOperator('DROP')).toThrow()
    expect(() => validateOperator('; --')).toThrow()
    expect(() => validateOperator('===')).toThrow()
  })
})

describe('validateSortDirection', () => {
  it('accepts asc and desc', () => {
    expect(() => validateSortDirection('asc')).not.toThrow()
    expect(() => validateSortDirection('desc')).not.toThrow()
  })

  it('rejects other strings', () => {
    expect(() => validateSortDirection('ASC; DROP TABLE')).toThrow()
  })
})
