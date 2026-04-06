import { describe, it, expect } from 'vitest'

import { createMysqlAdapter } from './mysql.js'

describe('createMysqlAdapter', () => {
  const config = {
    host: 'localhost',
    database: 'test',
    user: 'user',
    password: 'password',
  }

  it('returns an adapter with dialect mysql', () => {
    const adapter = createMysqlAdapter(config)
    expect(adapter.dialect).toBe('mysql')
  })

  it('throws if execute is called before connect', async () => {
    const adapter = createMysqlAdapter(config)
    await expect(adapter.execute('SELECT 1', [])).rejects.toThrow(
      'MySQL adapter is not connected'
    )
  })

  it('throws if beginTransaction is called before connect', async () => {
    const adapter = createMysqlAdapter(config)
    await expect(adapter.beginTransaction()).rejects.toThrow(
      'MySQL adapter is not connected'
    )
  })
})
