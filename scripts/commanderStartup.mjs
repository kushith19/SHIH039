/**
 * Pure helpers for AI Commander process startup (testable; used by start-stack).
 * Port listen alone is never "healthy" — GET /health must succeed.
 */

/** Uvicorn args for the normal/demo stack (no --reload). */
export function commanderUvicornArgs() {
  return ['-m', 'uvicorn', 'src.main:app', '--host', '0.0.0.0', '--port', '8000']
}

/**
 * @param {{ healthOk: boolean, portBusy: boolean }} state
 * @returns {'reuse' | 'replace' | 'start'}
 */
export function resolveCommanderLaunch({ healthOk, portBusy }) {
  if (healthOk) return 'reuse'
  if (portBusy) return 'replace'
  return 'start'
}

/** Demo/normal stack requires a successful GET /health before continuing. */
export function commanderHealthRequired() {
  return true
}
