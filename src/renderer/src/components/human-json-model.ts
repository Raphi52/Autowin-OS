export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export function parseJsonValue(value: unknown): JsonValue | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JsonValue
    } catch {
      return null
    }
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value) || (typeof value === 'object' && value !== null))
    return value as JsonValue
  return null
}
