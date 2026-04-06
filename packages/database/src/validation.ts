// ============================================================================
// @matthesketh/utopia-database — input validation
// ============================================================================

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/

const ALLOWED_OPERATORS = new Set([
  '=', '!=', '<', '>', '<=', '>=',
  'in', 'not in', 'is', 'is not', 'like', 'ilike',
])

const ALLOWED_SORT_DIRECTIONS = new Set(['asc', 'desc'])

export function validateIdentifier(name: string): void {
  if (!name || !IDENTIFIER_RE.test(name)) {
    throw new Error(
      `@matthesketh/utopia-database: Invalid identifier "${name}". ` +
      'Identifiers must match /^[a-zA-Z_][a-zA-Z0-9_.]*$/.'
    )
  }
}

export function validateOperator(op: string): void {
  if (!ALLOWED_OPERATORS.has(op)) {
    throw new Error(
      `@matthesketh/utopia-database: Invalid operator "${op}". ` +
      `Allowed: ${[...ALLOWED_OPERATORS].join(', ')}.`
    )
  }
}

export function validateSortDirection(dir: string): void {
  if (!ALLOWED_SORT_DIRECTIONS.has(dir.toLowerCase())) {
    throw new Error(
      `@matthesketh/utopia-database: Invalid sort direction "${dir}". Allowed: asc, desc.`
    )
  }
}
