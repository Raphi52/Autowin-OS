export class LatestRequestGate {
  private generation = 0

  begin(): number {
    this.generation += 1
    return this.generation
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.generation
  }

  invalidate(): void {
    this.generation += 1
  }
}

type SettledSources<T extends Record<string, Promise<unknown>>> = {
  values: Partial<{ [K in keyof T]: Awaited<T[K]> }>
  errors: Partial<Record<keyof T, string>>
}

export async function settleObservatorySources<T extends Record<string, Promise<unknown>>>(
  sources: T
): Promise<SettledSources<T>> {
  const entries = Object.entries(sources) as Array<[keyof T, Promise<unknown>]>
  const settled = await Promise.allSettled(entries.map(([, promise]) => promise))
  const values: SettledSources<T>['values'] = {}
  const errors: SettledSources<T>['errors'] = {}

  settled.forEach((result, index) => {
    const key = entries[index][0]
    if (result.status === 'fulfilled') values[key] = result.value as Awaited<T[typeof key]>
    else
      errors[key] = result.reason instanceof Error ? result.reason.message : String(result.reason)
  })
  return { values, errors }
}
