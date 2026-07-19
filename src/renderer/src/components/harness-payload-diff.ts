export type PayloadDiffLine =
  | { kind: 'same' | 'changed'; left: string; right: string }
  | { kind: 'removed'; left: string }
  | { kind: 'added'; right: string }

/** Diff de lecture, alignée par position : suffisante pour comparer deux injections bornées. */
export function diffPayloadLines(leftPayload: string, rightPayload: string): PayloadDiffLine[] {
  const left = leftPayload.split(/\r?\n/)
  const right = rightPayload.split(/\r?\n/)
  const length = Math.max(left.length, right.length)
  const result: PayloadDiffLine[] = []
  for (let index = 0; index < length; index += 1) {
    const before = left[index]
    const after = right[index]
    if (before === undefined) result.push({ kind: 'added', right: after })
    else if (after === undefined) result.push({ kind: 'removed', left: before })
    else result.push({ kind: before === after ? 'same' : 'changed', left: before, right: after })
  }
  return result
}
