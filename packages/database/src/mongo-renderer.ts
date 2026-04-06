// ============================================================================
// @matthesketh/utopia-database — MongoDB operation renderer
// ============================================================================

import type { QueryPlan, Condition } from './query-plan.js'

export interface MongoOperation {
  type: 'find' | 'insertOne' | 'insertMany' | 'updateMany' | 'deleteMany' | 'countDocuments'
  collection: string
  filter: Record<string, unknown>
  projection?: Record<string, 1>
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
  documents?: Record<string, unknown>[]
  update?: Record<string, unknown>
}

function likeToRegex(pattern: string): string {
  // escape regex special chars except %
  const escaped = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  // convert SQL LIKE % to .*
  return escaped.replace(/%/g, '.*')
}

function renderCondition(cond: Condition): Record<string, unknown> {
  const { column, operator, value } = cond
  const op = operator.toLowerCase()

  if (op === '=') {
    return { [column]: value }
  }

  if (op === '!=') {
    return { [column]: { $ne: value } }
  }

  if (op === '<') {
    return { [column]: { $lt: value } }
  }

  if (op === '>') {
    return { [column]: { $gt: value } }
  }

  if (op === '<=') {
    return { [column]: { $lte: value } }
  }

  if (op === '>=') {
    return { [column]: { $gte: value } }
  }

  if (op === 'in') {
    return { [column]: { $in: value as unknown[] } }
  }

  if (op === 'not in') {
    return { [column]: { $nin: value as unknown[] } }
  }

  if (op === 'is') {
    return { [column]: null }
  }

  if (op === 'is not') {
    return { [column]: { $ne: null } }
  }

  if (op === 'like') {
    const regex = likeToRegex(value as string)
    return { [column]: { $regex: regex, $options: '' } }
  }

  if (op === 'ilike') {
    const regex = likeToRegex(value as string)
    return { [column]: { $regex: regex, $options: 'i' } }
  }

  throw new Error(`@matthesketh/utopia-database: Unsupported operator "${operator}" for MongoDB`)
}

function buildFilter(plan: QueryPlan): Record<string, unknown> {
  const filter: Record<string, unknown> = {}

  for (const cond of plan.conditions) {
    const part = renderCondition(cond)
    Object.assign(filter, part)
  }

  if (plan.orConditions && plan.orConditions.length > 0) {
    const orParts = plan.orConditions.map((group) => {
      const groupFilter: Record<string, unknown> = {}
      for (const cond of group) {
        Object.assign(groupFilter, renderCondition(cond))
      }
      return groupFilter
    })
    filter.$or = orParts
  }

  return filter
}

export function renderMongo(plan: QueryPlan): MongoOperation {
  const collection = plan.table
  const filter = buildFilter(plan)

  switch (plan.operation) {
    case 'select': {
      const op: MongoOperation = {
        type: 'find',
        collection,
        filter,
      }

      if (plan.columns && plan.columns.length > 0) {
        const projection: Record<string, 1> = {}
        for (const col of plan.columns) {
          projection[col] = 1
        }
        op.projection = projection
      }

      if (plan.orderBy) {
        op.sort = {
          [plan.orderBy.column]: plan.orderBy.direction === 'asc' ? 1 : -1,
        }
      }

      if (plan.limit !== undefined) {
        op.limit = plan.limit
      }

      if (plan.offset !== undefined) {
        op.skip = plan.offset
      }

      return op
    }

    case 'count': {
      return {
        type: 'countDocuments',
        collection,
        filter,
      }
    }

    case 'insert': {
      const rows = plan.values!
      if (rows.length === 1) {
        return {
          type: 'insertOne',
          collection,
          filter,
          documents: rows as Record<string, unknown>[],
        }
      }
      return {
        type: 'insertMany',
        collection,
        filter,
        documents: rows as Record<string, unknown>[],
      }
    }

    case 'update': {
      const row = plan.values![0]
      return {
        type: 'updateMany',
        collection,
        filter,
        update: { $set: row },
      }
    }

    case 'delete': {
      return {
        type: 'deleteMany',
        collection,
        filter,
      }
    }

    default:
      throw new Error(`@matthesketh/utopia-database: Unknown operation "${(plan as QueryPlan).operation}"`)
  }
}
