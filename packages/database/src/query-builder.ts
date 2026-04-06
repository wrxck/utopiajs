// ============================================================================
// @matthesketh/utopia-database — fluent query builder
// ============================================================================

import type { QueryPlan, Operation, Condition } from './query-plan.js'
import { validateIdentifier, validateOperator, validateSortDirection } from './validation.js'

export class QueryBuilder {
  private plan: QueryPlan

  constructor(table: string) {
    validateIdentifier(table)
    this.plan = {
      operation: 'select',
      table,
      conditions: [],
    }
  }

  select(...columns: string[]): this {
    if (columns.length > 0) {
      for (const col of columns) validateIdentifier(col)
      this.plan.columns = columns
    }
    return this
  }

  where(columnOrObj: string | Record<string, unknown>, operator?: string, value?: unknown): this {
    if (typeof columnOrObj === 'object' && columnOrObj !== null) {
      for (const [col, val] of Object.entries(columnOrObj)) {
        validateIdentifier(col)
        this.plan.conditions.push({ column: col, operator: '=', value: val })
      }
    } else {
      validateIdentifier(columnOrObj)
      validateOperator(operator!)
      this.plan.conditions.push({ column: columnOrObj, operator: operator!, value: value as unknown })
    }
    return this
  }

  whereOr(groups: Record<string, unknown>[]): this {
    if (!this.plan.orConditions) this.plan.orConditions = []
    for (const group of groups) {
      const conditions: Condition[] = []
      for (const [col, val] of Object.entries(group)) {
        validateIdentifier(col)
        conditions.push({ column: col, operator: '=', value: val })
      }
      this.plan.orConditions.push(conditions)
    }
    return this
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.plan.operation = 'insert'
    const rows = Array.isArray(data) ? data : [data]
    for (const row of rows) {
      for (const col of Object.keys(row)) validateIdentifier(col)
    }
    this.plan.values = rows
    return this
  }

  update(data: Record<string, unknown>): this {
    this.plan.operation = 'update'
    for (const col of Object.keys(data)) validateIdentifier(col)
    this.plan.values = [data]
    return this
  }

  delete(): this {
    this.plan.operation = 'delete'
    return this
  }

  count(): this {
    this.plan.operation = 'count'
    return this
  }

  returning(...columns: string[]): this {
    for (const col of columns) validateIdentifier(col)
    this.plan.returning = columns
    return this
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    validateIdentifier(column)
    validateSortDirection(direction)
    this.plan.orderBy = { column, direction }
    return this
  }

  limit(n: number): this {
    this.plan.limit = n
    return this
  }

  offset(n: number): this {
    this.plan.offset = n
    return this
  }

  toPlan(): QueryPlan {
    return { ...this.plan }
  }
}
