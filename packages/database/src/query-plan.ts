// ============================================================================
// @matthesketh/utopia-database — query plan intermediate representation
// ============================================================================

import type { RawExpr } from './expr.js'

export type Operation = 'select' | 'insert' | 'update' | 'delete' | 'count'

export interface Condition {
  column: string
  operator: string
  value: unknown
}

export interface QueryPlan {
  operation: Operation
  table: string
  columns?: string[]
  conditions: Condition[]
  orConditions?: Condition[][]
  values?: Record<string, unknown | RawExpr>[]
  returning?: string[]
  orderBy?: { column: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
}
