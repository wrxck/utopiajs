// ============================================================================
// @matthesketh/utopia-database — public API
// ============================================================================

import { Database } from './database.js'
import type { DatabaseAdapter } from './types.js'

export function createDatabase(adapter: DatabaseAdapter): Database {
  return new Database(adapter)
}

export { Database } from './database.js'
export { RawExpr } from './expr.js'

export type {
  DatabaseAdapter,
  QueryResult,
  PoolConfig,
  TransactionHandle,
  PostgresConfig,
  MysqlConfig,
  SqliteConfig,
  MongoConfig,
  SqlMigration,
  MongoMigration,
  Migration,
  PlaceholderStyle,
} from './types.js'
