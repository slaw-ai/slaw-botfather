/**
 * Normalize drizzle `.execute(sql\`…\`)` results across drivers.
 * node-postgres returns a QueryResult ({ rows: [...] }); pglite returns
 * the same shape. Some driver/version combos return the array directly.
 */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
