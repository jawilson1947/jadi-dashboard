/**
 * Search-term helpers shared by the service that validates a search and the provider that turns it
 * into SQL. It lives in lib/ so the provider does not have to import the service layer — that import
 * would be a cycle, and a cycle is how one of the two ends up half-initialised at runtime.
 */

/** Escape LIKE metacharacters so a name containing % or _ is matched literally (with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_[\]]/g, (c) => `\\${c}`);
}
