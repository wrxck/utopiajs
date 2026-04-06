// ============================================================================
// @matthesketh/utopia-database — MongoDB adapter
// ============================================================================

import type { DatabaseAdapter, MongoConfig, QueryResult, TransactionHandle, MongoMigration } from '../types.js'
import type { MongoOperation } from '../mongo-renderer.js'

// ============================================================================
// extended interface — includes mongo-specific methods
// ============================================================================

export interface MongoAdapter extends DatabaseAdapter {
  executeMongo(op: MongoOperation): Promise<QueryResult>
  runMongoMigrations(migrations: MongoMigration[]): Promise<void>
}

// ============================================================================
// internal mongo driver types (minimal subset we need)
// ============================================================================

interface MongoCollection {
  find(filter: object, options?: object): { toArray(): Promise<Record<string, unknown>[]> }
  countDocuments(filter: object): Promise<number>
  insertOne(doc: object): Promise<{ insertedId: unknown }>
  insertMany(docs: object[]): Promise<{ insertedIds: Record<number, unknown>; insertedCount: number }>
  updateMany(filter: object, update: object): Promise<{ modifiedCount: number }>
  deleteMany(filter: object): Promise<{ deletedCount: number }>
}

interface MongoDb {
  collection(name: string): MongoCollection
}

interface MongoClientInstance {
  connect(): Promise<void>
  close(): Promise<void>
  db(name: string): MongoDb
}

interface MongoClientConstructor {
  new (uri: string, options?: object): MongoClientInstance
}

// ============================================================================
// createMongoAdapter
// ============================================================================

export function createMongoAdapter(config: MongoConfig): MongoAdapter {
  let client: MongoClientInstance | null = null
  let db: MongoDb | null = null

  return {
    dialect: 'mongodb',

    async connect(): Promise<void> {
      let mongodb: { MongoClient: MongoClientConstructor }
      try {
        mongodb = await import('mongodb') as { MongoClient: MongoClientConstructor }
      } catch {
        throw new Error('mongodb package is not installed. Run: npm install mongodb')
      }

      client = new mongodb.MongoClient(config.uri, {
        minPoolSize: config.pool?.min ?? 2,
        maxPoolSize: config.pool?.max ?? 10,
      })

      await client.connect()
      db = client.db(config.database)
    },

    async disconnect(): Promise<void> {
      if (client) {
        await client.close()
        client = null
        db = null
      }
    },

    execute(_sql: string, _params: unknown[]): Promise<QueryResult> {
      throw new Error(
        '@matthesketh/utopia-database: execute() is not supported for MongoDB. Use executeMongo() via the query builder.'
      )
    },

    beginTransaction(): Promise<TransactionHandle> {
      throw new Error(
        '@matthesketh/utopia-database: transactions are not yet supported for MongoDB. Use the native client directly.'
      )
    },

    commitTransaction(_handle: TransactionHandle): Promise<void> {
      throw new Error(
        '@matthesketh/utopia-database: transactions are not yet supported for MongoDB. Use the native client directly.'
      )
    },

    rollbackTransaction(_handle: TransactionHandle): Promise<void> {
      throw new Error(
        '@matthesketh/utopia-database: transactions are not yet supported for MongoDB. Use the native client directly.'
      )
    },

    executeInTransaction(_handle: TransactionHandle, _sql: string, _params: unknown[]): Promise<QueryResult> {
      throw new Error(
        '@matthesketh/utopia-database: transactions are not yet supported for MongoDB. Use the native client directly.'
      )
    },

    native(): unknown {
      return client
    },

    // ============================================================================
    // executeMongo — the real execution path for MongoDB
    // ============================================================================

    async executeMongo(op: MongoOperation): Promise<QueryResult> {
      if (!db) {
        throw new Error('@matthesketh/utopia-database: MongoDB adapter is not connected. Call connect() first.')
      }

      const collection = db.collection(op.collection)

      switch (op.type) {
        case 'find': {
          const cursor = collection.find(op.filter, {
            projection: op.projection,
            sort: op.sort,
            skip: op.skip,
            limit: op.limit,
          })
          const rows = await cursor.toArray()
          return { rows, rowCount: rows.length }
        }

        case 'countDocuments': {
          const count = await collection.countDocuments(op.filter)
          return { rows: [{ count }], rowCount: 1 }
        }

        case 'insertOne': {
          const doc = op.documents![0]
          const result = await collection.insertOne(doc)
          return { rows: [{ _id: result.insertedId }], rowCount: 1 }
        }

        case 'insertMany': {
          const result = await collection.insertMany(op.documents!)
          const ids = Object.values(result.insertedIds).map((id) => ({ _id: id }))
          return { rows: ids, rowCount: result.insertedCount }
        }

        case 'updateMany': {
          const result = await collection.updateMany(op.filter, op.update!)
          return { rows: [], rowCount: result.modifiedCount }
        }

        case 'deleteMany': {
          const result = await collection.deleteMany(op.filter)
          return { rows: [], rowCount: result.deletedCount }
        }

        default:
          throw new Error(`@matthesketh/utopia-database: Unknown MongoDB operation type "${(op as MongoOperation).type}"`)
      }
    },

    // ============================================================================
    // runMongoMigrations — tracks applied migrations in _migrations collection
    // ============================================================================

    async runMongoMigrations(migrations: MongoMigration[]): Promise<void> {
      if (!db) {
        throw new Error('@matthesketh/utopia-database: MongoDB adapter is not connected. Call connect() first.')
      }

      const migrationsCollection = db.collection('_migrations')

      for (const migration of migrations) {
        const existing = await migrationsCollection
          .find({ name: migration.name })
          .toArray()

        if (existing.length > 0) {
          continue
        }

        // run the migration
        await migration.up(client)

        // record as applied
        await migrationsCollection.insertOne({
          name: migration.name,
          appliedAt: new Date().toISOString(),
        })
      }
    },
  }
}
