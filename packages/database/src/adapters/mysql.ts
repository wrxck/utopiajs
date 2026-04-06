import { randomUUID } from 'node:crypto'
import type {
  DatabaseAdapter,
  MysqlConfig,
  QueryResult,
  TransactionHandle,
} from '../types.js'

interface MySqlResultSetHeader {
  affectedRows: number
}

interface MySqlConnection {
  execute(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[] | MySqlResultSetHeader, unknown]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

interface MySqlPool {
  execute(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[] | MySqlResultSetHeader, unknown]>
  getConnection(): Promise<MySqlConnection>
  end(): Promise<void>
}

interface MySql2Module {
  createPool(config: object): { promise(): MySqlPool }
}

function normaliseResult(rows: Record<string, unknown>[] | MySqlResultSetHeader): QueryResult {
  if (Array.isArray(rows)) {
    return { rows, rowCount: rows.length }
  }
  return { rows: [], rowCount: (rows as MySqlResultSetHeader).affectedRows }
}

export function createMysqlAdapter(config: MysqlConfig): DatabaseAdapter {
  let pool: MySqlPool | null = null
  const txConnections = new Map<string, MySqlConnection>()

  return {
    dialect: 'mysql',

    async connect(): Promise<void> {
      let mysql2: MySql2Module
      try {
        mysql2 = await import('mysql2') as MySql2Module
      } catch {
        throw new Error(
          'mysql2 package is not installed. Run: npm install mysql2'
        )
      }

      pool = mysql2.createPool({
        host: config.host,
        port: config.port ?? 3306,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        connectionLimit: config.pool?.max ?? 10,
      }).promise()
    },

    async disconnect(): Promise<void> {
      if (pool) {
        await pool.end()
        pool = null
      }
    },

    async execute(sql: string, params: unknown[]): Promise<QueryResult> {
      if (!pool) {
        throw new Error('MySQL adapter is not connected. Call connect() first.')
      }
      const [rows] = await pool.execute(sql, params)
      return normaliseResult(rows as Record<string, unknown>[] | MySqlResultSetHeader)
    },

    async beginTransaction(): Promise<TransactionHandle> {
      if (!pool) {
        throw new Error('MySQL adapter is not connected. Call connect() first.')
      }
      const conn = await pool.getConnection()
      await conn.beginTransaction()
      const id = randomUUID()
      txConnections.set(id, conn)
      return { id }
    },

    async commitTransaction(handle: TransactionHandle): Promise<void> {
      const conn = txConnections.get(handle.id)
      if (!conn) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      await conn.commit()
      conn.release()
      txConnections.delete(handle.id)
    },

    async rollbackTransaction(handle: TransactionHandle): Promise<void> {
      const conn = txConnections.get(handle.id)
      if (!conn) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      await conn.rollback()
      conn.release()
      txConnections.delete(handle.id)
    },

    async executeInTransaction(
      handle: TransactionHandle,
      sql: string,
      params: unknown[]
    ): Promise<QueryResult> {
      const conn = txConnections.get(handle.id)
      if (!conn) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      const [rows] = await conn.execute(sql, params)
      return normaliseResult(rows as Record<string, unknown>[] | MySqlResultSetHeader)
    },

    native(): unknown {
      return pool
    },
  }
}
