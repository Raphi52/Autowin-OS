export interface MergeableActivityEntry {
  ts: string
  kind: string
  label: string
  text?: string
}

export function mergeActivityEntries<T extends MergeableActivityEntry>(
  local: T[],
  global: T[]
): T[] {
  const merged = [...local]
  for (const entry of global) {
    const duplicate = local.some(
      (candidate) =>
        candidate.kind === entry.kind &&
        candidate.label === entry.label &&
        candidate.text === entry.text &&
        Math.abs(Date.parse(candidate.ts) - Date.parse(entry.ts)) < 1_000
    )
    if (!duplicate) merged.push(entry)
  }
  return merged.sort((a, b) => a.ts.localeCompare(b.ts))
}
