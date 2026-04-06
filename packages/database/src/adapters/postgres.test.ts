import { describe, it, expect } from 'vitest'

import { createPostgresAdapter } from './postgres.js'

describe('createPostgresAdapter', () => {
  const config = {
    host: 'localhost',
    database: 'test',
    user: 'user',
    password: 'password',
  }

  it('returns an adapter with dialect postgres', () => {
    const adapter = createPostgresAdapter(config)
    expect(adapter.dialect).toBe('postgres')
  })

  it('throws if execute is called before connect', async () => {
    const adapter = createPostgresAdapter(config)
    await expect(adapter.execute('SELECT 1', [])).rejects.toThrow(
      'PostgreSQL adapter is not connected'
    )
  })

  it('throws if beginTransaction is called before connect', async () => {
    const adapter = createPostgresAdapter(config)
    await expect(adapter.beginTransaction()).rejects.toThrow(
      'PostgreSQL adapter is not connected'
    )
  })
})
