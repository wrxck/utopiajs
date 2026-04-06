import { randomUUID } from 'node:crypto'

import type {
  DatabaseAdapter,
  SqliteConfig,
  QueryResult,
  TransactionHandle,
} from '../types.js'

interface BetterSqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number }
}

interface BetterSqliteDatabase {
  prepare(sql: string): BetterSqliteStatement
  close(): void
}

type BetterSqliteConstructor = new (
  filename: string,
  options?: { readonly?: boolean }
) => BetterSqliteDatabase

const SELECT_RE = /^\s*(SELECT|PRAGMA)\b/i

export function createSqliteAdapter(config: SqliteConfig): DatabaseAdapter {
  let db: BetterSqliteDatabase | null = null
  let txCounter = 0
  const activeTx = new Map<string, string>() // id → savepoint name

  return {
    dialect: 'sqlite',

    async connect(): Promise<void> {
      let mod: { default?: BetterSqliteConstructor } | BetterSqliteConstructor
      try {
        mod = await import('better-sqlite3') as { default?: BetterSqliteConstructor }
      } catch {
        throw new Error(
          'better-sqlite3 package is not installed. Run: npm install better-sqlite3'
        )
      }

      const Database = (mod as { default?: BetterSqliteConstructor }).default ?? (mod as BetterSqliteConstructor)
      if (!Database) {
        throw new Error('Could not resolve Database constructor from better-sqlite3.')
      }

      db = new Database(config.filename, {
        readonly: config.readonly ?? false,
      })

      db.prepare('PRAGMA journal_mode = WAL').run()
    },

    async disconnect(): Promise<void> {
      if (db) {
        db.close()
        db = null
      }
    },

    async execute(sql: string, params: unknown[]): Promise<QueryResult> {
      if (!db) {
        throw new Error('SQLite adapter is not connected. Call connect() first.')
      }
      const stmt = db.prepare(sql)
      if (SELECT_RE.test(sql)) {
        const rows = stmt.all(...params)
        return { rows, rowCount: rows.length }
      } else {
        const info = stmt.run(...params)
        return { rows: [], rowCount: info.changes }
      }
    },

    async beginTransaction(): Promise<TransactionHandle> {
      if (!db) {
        throw new Error('SQLite adapter is not connected. Call connect() first.')
      }
      const n = ++txCounter
      const savepoint = `sqlite-tx-${n}`
      db.prepare(`SAVEPOINT "${savepoint}"`).run()
      const id = randomUUID()
      activeTx.set(id, savepoint)
      return { id }
    },

    async commitTransaction(handle: TransactionHandle): Promise<void> {
      const savepoint = activeTx.get(handle.id)
      if (!savepoint) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      db!.prepare(`RELEASE SAVEPOINT "${savepoint}"`).run()
      activeTx.delete(handle.id)
    },

    async rollbackTransaction(handle: TransactionHandle): Promise<void> {
      const savepoint = activeTx.get(handle.id)
      if (!savepoint) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      db!.prepare(`ROLLBACK TO SAVEPOINT "${savepoint}"`).run()
      db!.prepare(`RELEASE SAVEPOINT "${savepoint}"`).run()
      activeTx.delete(handle.id)
    },

    async executeInTransaction(
      handle: TransactionHandle,
      sql: string,
      params: unknown[]
    ): Promise<QueryResult> {
      if (!activeTx.has(handle.id)) {
        throw new Error(`No transaction found with id: ${handle.id}`)
      }
      return this.execute(sql, params)
    },

    native(): unknown {
      return db
    },
  }
}
