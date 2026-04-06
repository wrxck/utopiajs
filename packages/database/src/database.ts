// ============================================================================
// @matthesketh/utopia-database — database class with query execution
// ============================================================================

import type { DatabaseAdapter, QueryResult, Migration, SqlMigration, MongoMigration } from './types.js'
import { QueryBuilder } from './query-builder.js'
import { renderSql } from './sql-renderer.js'
import { renderMongo, type MongoOperation } from './mongo-renderer.js'
import { runSqlMigrations } from './migration.js'
import { RawExpr } from './expr.js'

// mongodb adapter extended interface (not in base DatabaseAdapter)
interface MongoAdapter extends DatabaseAdapter {
  executeMongo(op: MongoOperation): Promise<QueryResult>
  runMongoMigrations(migrations: MongoMigration[]): Promise<void>
}

function isMongoAdapter(adapter: DatabaseAdapter): adapter is MongoAdapter {
  return adapter.dialect === 'mongodb'
}

function isSqlMigration(m: Migration): m is SqlMigration {
  return typeof (m as SqlMigration).up === 'string'
}

// ============================================================================
// executable query — wraps QueryBuilder and adds terminal methods
// ============================================================================

export class ExecutableQuery {
  private _builder: QueryBuilder
  private _db: Database
  private _txHandle: import('./types.js').TransactionHandle | null

  constructor(
    table: string,
    db: Database,
    txHandle: import('./types.js').TransactionHandle | null = null,
  ) {
    this._builder = new QueryBuilder(table)
    this._db = db
    this._txHandle = txHandle
  }

  // proxy all QueryBuilder chain methods

  select(...columns: string[]): this {
    this._builder.select(...columns)
    return this
  }

  where(columnOrObj: string | Record<string, unknown>, operator?: string, value?: unknown): this {
    if (typeof columnOrObj === 'object' && columnOrObj !== null) {
      this._builder.where(columnOrObj)
    } else {
      this._builder.where(columnOrObj, operator!, value)
    }
    return this
  }

  whereOr(groups: Record<string, unknown>[]): this {
    this._builder.whereOr(groups)
    return this
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this._builder.insert(data)
    return this
  }

  update(data: Record<string, unknown>): this {
    this._builder.update(data)
    return this
  }

  delete(): this {
    this._builder.delete()
    return this
  }

  returning(...columns: string[]): this {
    this._builder.returning(...columns)
    return this
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this._builder.orderBy(column, direction)
    return this
  }

  limit(n: number): this {
    this._builder.limit(n)
    return this
  }

  offset(n: number): this {
    this._builder.offset(n)
    return this
  }

  // terminal execution methods

  async all(): Promise<Record<string, unknown>[]> {
    const result = await this._db._executePlan(this._builder.toPlan(), this._txHandle)
    return result.rows
  }

  async first(): Promise<Record<string, unknown> | null> {
    this._builder.limit(1)
    const result = await this._db._executePlan(this._builder.toPlan(), this._txHandle)
    return result.rows[0] ?? null
  }

  async count(): Promise<number> {
    this._builder.count()
    const result = await this._db._executePlan(this._builder.toPlan(), this._txHandle)
    const row = result.rows[0]
    if (row) {
      const val = row['count'] ?? row['COUNT(*)']
      return Number(val)
    }
    return 0
  }

  async execute(): Promise<QueryResult> {
    return this._db._executePlan(this._builder.toPlan(), this._txHandle)
  }

  // thenable — allows `await db.query('x').insert(data)` without .execute()
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

// ============================================================================
// transaction context — passed to transaction() callback
// ============================================================================

export interface TransactionContext {
  query(table: string): ExecutableQuery
}

// ============================================================================
// database — main public API
// ============================================================================

export class Database {
  private _adapter: DatabaseAdapter

  constructor(adapter: DatabaseAdapter) {
    this._adapter = adapter
  }

  async connect(): Promise<void> {
    return this._adapter.connect()
  }

  async disconnect(): Promise<void> {
    return this._adapter.disconnect()
  }

  query(table: string): ExecutableQuery {
    return new ExecutableQuery(table, this)
  }

  raw(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (isMongoAdapter(this._adapter)) {
      throw new Error('@matthesketh/utopia-database: raw() is not supported for MongoDB adapters')
    }
    return this._adapter.execute(sql, params)
  }

  expr(sql: string, params: unknown[] = []): RawExpr {
    return new RawExpr(sql, params)
  }

  native(): unknown {
    return this._adapter.native()
  }

  async transaction<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const handle = await this._adapter.beginTransaction()
    const ctx: TransactionContext = {
      query: (table: string) => new ExecutableQuery(table, this, handle),
    }
    try {
      const result = await callback(ctx)
      await this._adapter.commitTransaction(handle)
      return result
    } catch (err) {
      await this._adapter.rollbackTransaction(handle)
      throw err
    }
  }

  async migrate(migrations: Migration[]): Promise<void> {
    if (isMongoAdapter(this._adapter)) {
      const mongoMigrations = migrations as MongoMigration[]
      return this._adapter.runMongoMigrations(mongoMigrations)
    }
    const sqlMigrations = migrations.filter(isSqlMigration) as SqlMigration[]
    return runSqlMigrations(this._adapter, sqlMigrations)
  }

  // internal — used by ExecutableQuery
  async _executePlan(
    plan: import('./query-plan.js').QueryPlan,
    txHandle: import('./types.js').TransactionHandle | null,
  ): Promise<QueryResult> {
    if (isMongoAdapter(this._adapter)) {
      const op = renderMongo(plan)
      return this._adapter.executeMongo(op)
    }

    const style = this._adapter.dialect === 'postgres' ? 'dollar' : 'question'
    const [sql, params] = renderSql(plan, style)

    if (txHandle) {
      return this._adapter.executeInTransaction(txHandle, sql, params)
    }
    return this._adapter.execute(sql, params)
  }
}
