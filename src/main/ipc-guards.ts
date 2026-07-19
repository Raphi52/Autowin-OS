export function guardBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`IPC ${name}: boolean attendu`)
  return value
}
