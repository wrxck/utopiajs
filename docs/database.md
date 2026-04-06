# @matthesketh/utopia-database

Type-safe query builder and migration runner for Postgres, MySQL, SQLite, and MongoDB.

## Install

```bash
npm install @matthesketh/utopia-database
```

Install the driver for your adapter:

| Adapter  | Driver            |
|----------|-------------------|
| Postgres | `npm install pg`  |
| MySQL    | `npm install mysql2` |
| SQLite   | `npm install better-sqlite3` |
| MongoDB  | `npm install mongodb` |

## Quick start (Postgres)

```ts
import { createDatabase, createPostgresAdapter } from '@matthesketh/utopia-database'

const db = createDatabase(createPostgresAdapter({
  host: 'localhost',
  database: 'myapp',
  user: 'postgres',
  password: 'secret',
}))

await db.connect()

const users = await db.query('users').where('active', '=', true).all()
```

## Adapters

### Postgres

```ts
import { createPostgresAdapter } from '@matthesketh/utopia-database'

createPostgresAdapter({
  host: 'localhost',
  port: 5432,           // default
  database: 'myapp',
  user: 'postgres',
  password: 'secret',
  ssl: false,           // boolean or tls.ConnectionOptions
  pool: { min: 2, max: 10 },
})
```

### MySQL

```ts
import { createMysqlAdapter } from '@matthesketh/utopia-database'

createMysqlAdapter({
  host: 'localhost',
  port: 3306,           // default
  database: 'myapp',
  user: 'root',
  password: 'secret',
  ssl: {},              // optional tls options
  pool: { min: 2, max: 10 },
})
```

### SQLite

```ts
import { createSqliteAdapter } from '@matthesketh/utopia-database'

createSqliteAdapter({
  filename: './data.db',
  readonly: false,      // default
})
```

SQLite opens with WAL journal mode automatically.

### MongoDB

```ts
import { createMongoAdapter } from '@matthesketh/utopia-database'

createMongoAdapter({
  uri: 'mongodb://localhost:27017',
  database: 'myapp',
  pool: { min: 2, max: 10 },
})
```

MongoDB does not support `raw()` or transactions via this package. Use `db.native()` for those.

## Query builder

All queries start with `db.query(table)` and are executed by calling a terminal method.

### Select

```ts
// all rows
const rows = await db.query('posts').all()

// specific columns
const rows = await db.query('posts').select('id', 'title').all()

// first row (null if not found)
const post = await db.query('posts').where('id', '=', 1).first()

// count
const total = await db.query('posts').where('active', '=', true).count()
```

### where

```ts
// column, operator, value
db.query('posts').where('status', '=', 'published')
db.query('posts').where('score', '>', 10)

// object shorthand (equality)
db.query('posts').where({ status: 'published', pinned: true })

// OR conditions
db.query('posts').whereOr([
  { status: 'published' },
  { status: 'featured' },
])
```

### orderBy / limit / offset

```ts
db.query('posts')
  .orderBy('created_at', 'desc')
  .limit(10)
  .offset(20)
  .all()
```

### insert

```ts
// single row
await db.query('users').insert({ name: 'Alice', email: 'alice@example.com' })

// multiple rows
await db.query('users').insert([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' },
])

// with RETURNING (Postgres only)
const result = await db.query('users')
  .insert({ name: 'Alice', email: 'alice@example.com' })
  .returning('id')
  .execute()
```

### update with expr()

```ts
// plain update
await db.query('posts')
  .where('id', '=', 42)
  .update({ title: 'New title' })

// raw SQL expression (e.g. increment counter)
await db.query('posts')
  .where('id', '=', 42)
  .update({ views: db.expr('views + 1') })
```

`db.expr(sql, params?)` returns a `RawExpr` that is inlined verbatim into the rendered SQL.

### delete

```ts
await db.query('posts').where('id', '=', 42).delete()
```

## Raw queries

For SQL not expressible through the builder:

```ts
const result = await db.raw(
  'SELECT * FROM users WHERE created_at > $1',
  [new Date('2024-01-01')]
)
// result: { rows: [...], rowCount: number }
```

`raw()` is not available on MongoDB adapters.

## Transactions

```ts
await db.transaction(async (tx) => {
  await tx.query('accounts').where('id', '=', 1).update({ balance: db.expr('balance - 100') })
  await tx.query('accounts').where('id', '=', 2).update({ balance: db.expr('balance + 100') })
})
```

The callback receives a `TransactionContext` with a `query()` method. Commit and rollback are handled automatically.

> MongoDB does not support transactions through this package.

## Migrations

### SQL migrations (Postgres, MySQL, SQLite)

```ts
import type { SqlMigration } from '@matthesketh/utopia-database'

const migrations: SqlMigration[] = [
  {
    name: '001_create_users',
    up: `CREATE TABLE users (
      id   SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    )`,
    down: 'DROP TABLE users',
  },
  {
    name: '002_add_active',
    up:   'ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true',
    down: 'ALTER TABLE users DROP COLUMN active',
  },
]

await db.migrate(migrations)
```

Migrations are tracked in a `_migrations` table and only applied once. Each migration runs inside a transaction.

### MongoDB migrations

```ts
import type { MongoMigration } from '@matthesketh/utopia-database'

const migrations: MongoMigration[] = [
  {
    name: '001_add_index',
    up: async (client) => {
      const db = (client as any).db('myapp')
      await db.collection('users').createIndex({ email: 1 }, { unique: true })
    },
    down: async (client) => {
      const db = (client as any).db('myapp')
      await db.collection('users').dropIndex('email_1')
    },
  },
]

await db.migrate(migrations)
```

Applied migrations are tracked in a `_migrations` collection.

## Security model

The query builder validates all table names, column names, and operators against an identifier allowlist before generating SQL. Values are always passed as parameterised placeholders — never interpolated into the SQL string.

`db.expr()` bypasses this and inlines SQL verbatim. Only use it with static strings or fully-trusted input.

## Native access

Access the underlying driver instance when you need capabilities outside the query builder:

```ts
import type { Pool } from 'pg'
const pool = db.native() as Pool

import type { MongoClient } from 'mongodb'
const client = db.native() as MongoClient
```
