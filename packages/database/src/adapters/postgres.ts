import { randomUUID } from 'node:crypto'
import type {
  DatabaseAdapter,
  PostgresConfig,
  QueryResult,
  TransactionHandle,
} from '../types.js'

interface PgQueryResult {
  rows: Record<string, unknown>[]
  rowCount: number | null
}

interface PgClient {
  query(sql: string, params?: unknown[]): Promise<PgQueryResult>
  release(): void
}

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<PgQueryResult>
  connect(): Promise<PgClient>
  end(): Promise<void>
}

export function createPostgresAdapter(config: PostgresConfig): DatabaseAdapter {
  let pool: PgPool | null = null
  const txClients = new Map<string, PgClient>()

  return {
    dialect: 'postgres',

    async connect(): Promise<void> {
      let pg: { default?: { Pool: new (cfg: object) => PgPool }; Pool?: new (cfg: object) => PgPool }
      try {
        pg = await import('pg') as { default?: { Pool: new (cfg: object) => PgPool }; Pool?: new (cfg: object) => PgPool }
      } catch {
        throw new Error(
          'pg package is not installed. Run: npm install pg'
        )
      }

      const Pool = pg.default?.Pool ?? pg.Pool
      if (!Pool) {
        throw new Error('Could not resolve pg.Pool from the pg package.')
      }
      pool = new Pool({
        host: config.host,
        port: config.port ?? 5432,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        min: config.pool?.min ?? 2,
        max: config.pool?.max ?? 10,
      })
    },

    async disconnect(): Promise<void> {
      if (pool) {
        await pool.end()
        pool = null
      }
    },

    async execute(sql: string, params: unknown[]): Promise<QueryResult> {
      if (!pool) {
        throw new Error('PostgreSQL adapter is not connected. Call connect() first.')
      }
      const result = await pool.query(sql, params)
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      }
    },

    async beginTransaction(): Promise<TransactionHandle> {
      if (!pool) {
        throw new Error('PostgreSQL adapter is not connected. Call connect() first.')
      }
      const client = await pool.connect()
      await client.query('BEGIN')
      const id = randomUUID()
      txClients.set(id, client)
      return { id }
    },

    async commitTransaction(handle: TransactionHandle): Promise<void> {
      const client = txClients.get(handle.id)
      if (!client) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      await client.query('COMMIT')
      client.release()
      txClients.delete(handle.id)
    },

    async rollbackTransaction(handle: TransactionHandle): Promise<void> {
      const client = txClients.get(handle.id)
      if (!client) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      await client.query('ROLLBACK')
      client.release()
      txClients.delete(handle.id)
    },

    async executeInTransaction(
      handle: TransactionHandle,
      sql: string,
      params: unknown[]
    ): Promise<QueryResult> {
      const client = txClients.get(handle.id)
      if (!client) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      const result = await client.query(sql, params)
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      }
    },

    native(): unknown {
      return pool
    },
  }
}
