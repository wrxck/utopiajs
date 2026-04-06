// ============================================================================
// @matthesketh/utopia-database — SQL renderer
// ============================================================================

import type { QueryPlan, Condition } from './query-plan.js'
import type { PlaceholderStyle } from './types.js'
import { RawExpr } from './expr.js'

function quoteIdent(name: string): string {
  return `"${name}"`
}

function placeholder(style: PlaceholderStyle, index: number): string {
  return style === 'dollar' ? `$${index}` : '?'
}

function renderCondition(
  cond: Condition,
  style: PlaceholderStyle,
  params: unknown[],
): string {
  const col = quoteIdent(cond.column)
  const op = cond.operator.toUpperCase()

  if (op === 'IS' && cond.value === null) {
    return `${col} IS NULL`
  }

  if (op === 'IS NOT' && cond.value === null) {
    return `${col} IS NOT NULL`
  }

  if (op === 'IN') {
    const values = cond.value as unknown[]
    const placeholders = values.map((v) => {
      params.push(v)
      return placeholder(style, params.length)
    })
    return `${col} IN (${placeholders.join(', ')})`
  }

  params.push(cond.value)
  return `${col} ${op} ${placeholder(style, params.length)}`
}

function renderWhereClause(
  plan: QueryPlan,
  style: PlaceholderStyle,
  params: unknown[],
): string {
  const parts: string[] = []

  for (const cond of plan.conditions) {
    parts.push(renderCondition(cond, style, params))
  }

  if (plan.orConditions && plan.orConditions.length > 0) {
    const orParts = plan.orConditions.flatMap((group) =>
      group.map((cond) => renderCondition(cond, style, params)),
    )
    parts.push(`(${orParts.join(' OR ')})`)
  }

  if (parts.length === 0) return ''
  return ` WHERE ${parts.join(' AND ')}`
}

export function renderSql(plan: QueryPlan, style: PlaceholderStyle): [string, unknown[]] {
  const params: unknown[] = []
  const table = quoteIdent(plan.table)

  switch (plan.operation) {
    case 'select':
    case 'count': {
      const cols =
        plan.operation === 'count'
          ? 'COUNT(*) AS "count"'
          : plan.columns
          ? plan.columns.map(quoteIdent).join(', ')
          : '*'

      let sql = `SELECT ${cols} FROM ${table}`
      sql += renderWhereClause(plan, style, params)

      if (plan.orderBy) {
        sql += ` ORDER BY ${quoteIdent(plan.orderBy.column)} ${plan.orderBy.direction.toUpperCase()}`
      }
      if (plan.limit !== undefined) {
        sql += ` LIMIT ${plan.limit}`
      }
      if (plan.offset !== undefined) {
        sql += ` OFFSET ${plan.offset}`
      }

      return [sql, params]
    }

    case 'insert': {
      const rows = plan.values!
      const keys = Object.keys(rows[0])
      const colList = keys.map(quoteIdent).join(', ')

      const valueSets = rows.map((row) => {
        const placeholders = keys.map((key) => {
          params.push(row[key])
          return placeholder(style, params.length)
        })
        return `(${placeholders.join(', ')})`
      })

      let sql = `INSERT INTO ${table} (${colList}) VALUES ${valueSets.join(', ')}`

      if (plan.returning && plan.returning.length > 0) {
        sql += ` RETURNING ${plan.returning.map(quoteIdent).join(', ')}`
      }

      return [sql, params]
    }

    case 'update': {
      const row = plan.values![0]
      const setClauses = Object.entries(row).map(([key, value]) => {
        const col = quoteIdent(key)
        if (value instanceof RawExpr) {
          // translate ? placeholders in the raw expression to the correct style
          let exprSql = value.sql
          for (const p of value.params) {
            params.push(p)
            const ph = placeholder(style, params.length)
            exprSql = exprSql.replace('?', ph)
          }
          return `${col} = ${exprSql}`
        }
        params.push(value)
        return `${col} = ${placeholder(style, params.length)}`
      })

      let sql = `UPDATE ${table} SET ${setClauses.join(', ')}`
      sql += renderWhereClause(plan, style, params)

      return [sql, params]
    }

    case 'delete': {
      let sql = `DELETE FROM ${table}`
      sql += renderWhereClause(plan, style, params)
      return [sql, params]
    }

    default:
      throw new Error(`Unknown operation: ${(plan as QueryPlan).operation}`)
  }
}
