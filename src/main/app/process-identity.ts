/**
 * Compare two process fingerprints emitted by the platform probe.
 *
 * Windows and Linux encode `startedAt|executable`. The start instant is the stable process
 * identity; access to the executable path is best-effort and may change without the PID being
 * recycled. Platforms without that delimiter retain exact-match semantics.
 */
export function isSameProcessIdentity(captured: string, current: string): boolean {
  if (captured === current) return true
  const capturedSeparator = captured.indexOf('|')
  const currentSeparator = current.indexOf('|')
  return (
    capturedSeparator > 0 &&
    currentSeparator > 0 &&
    captured.slice(0, capturedSeparator) === current.slice(0, currentSeparator)
  )
}
