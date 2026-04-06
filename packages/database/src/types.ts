// ============================================================================
// @matthesketh/utopia-database — shared types
// ============================================================================

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
}

export interface PoolConfig {
  min?: number
  max?: number
}

export interface TransactionHandle {
  id: string
}

export interface DatabaseAdapter {
  readonly dialect: 'postgres' | 'mysql' | 'sqlite' | 'mongodb'
  connect(): Promise<void>
  disconnect(): Promise<void>
  execute(sql: string, params: unknown[]): Promise<QueryResult>
  beginTransaction(): Promise<TransactionHandle>
  commitTransaction(handle: TransactionHandle): Promise<void>
  rollbackTransaction(handle: TransactionHandle): Promise<void>
  executeInTransaction(handle: TransactionHandle, sql: string, params: unknown[]): Promise<QueryResult>
  native(): unknown
}

export interface PostgresConfig {
  host: string
  port?: number
  database: string
  user: string
  password: string
  pool?: PoolConfig
  ssl?: boolean | object
}

export interface MysqlConfig {
  host: string
  port?: number
  database: string
  user: string
  password: string
  pool?: PoolConfig
  ssl?: object
}

export interface SqliteConfig {
  filename: string
  readonly?: boolean
}

export interface MongoConfig {
  uri: string
  database: string
  pool?: PoolConfig
}

export interface SqlMigration {
  name: string
  up: string
  down: string
}

export interface MongoMigration {
  name: string
  up: (client: unknown) => Promise<void>
  down: (client: unknown) => Promise<void>
}

export type Migration = SqlMigration | MongoMigration

export type PlaceholderStyle = 'dollar' | 'question'
