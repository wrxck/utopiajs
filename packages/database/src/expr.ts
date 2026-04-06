// ============================================================================
// @matthesketh/utopia-database — raw SQL expression marker
// ============================================================================

export class RawExpr {
  constructor(
    public readonly sql: string,
    public readonly params: unknown[] = [],
  ) {}
}
