import { useState } from 'react'
import './HumanJson.css'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

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

function JsonTree({ value, depth = 0 }: { value: JsonValue; depth?: number }): React.JSX.Element {
  if (value === null) return <span className="human-json__null">aucune valeur</span>
  if (typeof value === 'boolean')
    return <span className="human-json__boolean">{value ? 'oui' : 'non'}</span>
  if (typeof value === 'number')
    return <span className="human-json__number">{value.toLocaleString('fr-FR')}</span>
  if (typeof value === 'string') return <span className="human-json__string">{value || '—'}</span>

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index + 1), item] as const)
    : Object.entries(value)
  const label = Array.isArray(value)
    ? `${entries.length} élément${entries.length > 1 ? 's' : ''}`
    : `${entries.length} propriété${entries.length > 1 ? 's' : ''}`
  return (
    <details className="human-json__group" open={depth < 2}>
      <summary>{label}</summary>
      <dl>
        {entries.map(([key, child]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <JsonTree value={child} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function HumanJson({
  value,
  className = ''
}: {
  value: unknown
  className?: string
}): React.JSX.Element {
  const parsed = parseJsonValue(value)
  const [readable, setReadable] = useState(false)
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (parsed === null) return <pre className={className}>{raw}</pre>
  return (
    <section className={`human-json ${className}`}>
      <button
        type="button"
        className="human-json__toggle"
        onClick={() => setReadable((current) => !current)}
      >
        {readable ? 'Voir brut' : 'Rendre lisible'}
      </button>
      {readable ? (
        <div className="human-json__tree">
          <JsonTree value={parsed} />
        </div>
      ) : (
        <pre>{raw}</pre>
      )}
    </section>
  )
}
