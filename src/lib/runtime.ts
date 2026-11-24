/**
 * True when running under the test runner. Checks VITEST (always set by
 * Vitest) as well as NODE_ENV, so overriding NODE_ENV can't defeat it.
 */
export function isTestRuntime(): boolean {
  return process.env.NODE_ENV === "test" || !!process.env.VITEST;
}
