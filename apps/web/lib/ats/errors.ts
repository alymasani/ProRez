/** Error classification shared by the transport, the scheduler and the UI. No Node APIs. */

/** Configuration errors: retrying on a schedule cannot help until the board is fixed. */
export function isPermanentConfigError(code: string | null | undefined): boolean {
  return code === "not_found" || code === "invalid_board" || code === "blocked_host";
}
