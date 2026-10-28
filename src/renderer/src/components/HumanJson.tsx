import { useState } from 'react'
import { langueCourante, formaterNombre } from '../langue'
import { useTextesObservatory, traduireObservatory } from '../textes-ecrans/observatory'
import './HumanJson.css'
import { parseJsonValue, type JsonValue } from './human-json-model'

function isPrimitive(value: JsonValue): boolean {
  return value === null || typeof value !== 'object'
}

function Leaf({ value }: { value: JsonValue }): React.JSX.Element {
  const { t } = useTextesObservatory()
  if (value === null) return <span className="human-json__null">{t('json.aucuneValeur')}</span>
  if (typeof value === 'boolean')
    return <span className="human-json__boolean">{value ? t('json.oui') : t('json.non')}</span>
  if (typeof value === 'number')
    return <span className="human-json__number">{formaterNombre(value)}</span>
  return <span className="human-json__string">{value === '' ? '—' : String(value)}</span>
}

function JsonTree({ value, depth = 0 }: { value: JsonValue; depth?: number }): React.JSX.Element {
  if (isPrimitive(value)) return <Leaf value={value} />

  const isArray = Array.isArray(value)
  const entries = isArray
    ? (value as JsonValue[]).map((item, index) => [String(index + 1), item] as const)
    : Object.entries(value as Record<string, JsonValue>)
  const count = entries.length
  const label = isArray
    ? traduireObservatory('json.elements', langueCourante(), { n: count, s: count > 1 ? 's' : '' })
    : traduireObservatory('json.proprietes', langueCourante(), {
        n: count,
        s: count > 1 ? 's' : ''
      })
  // Feuilles simples (ex. argv) → liste à plat pleine largeur : plus de colonne étranglée.
  const flat = entries.every(([, child]) => isPrimitive(child))

  return (
    <details className="human-json__group" open={depth < 2}>
      <summary>{label}</summary>
      <div className={`human-json__body${flat ? ' is-flat' : ''}${isArray ? ' is-array' : ''}`}>
        {entries.map(([key, child]) => (
          <div className="human-json__row" key={key}>
            <span className="human-json__key" title={key}>
              {key}
            </span>
            <div className="human-json__value">
              <JsonTree value={child} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
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
  const { t } = useTextesObservatory()
  const parsed = parseJsonValue(value)
  const [readable, setReadable] = useState(true)
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (parsed === null) return <pre className={className}>{raw}</pre>
  return (
    <section className={`human-json ${className}`}>
      <button
        type="button"
        className="human-json__toggle"
        onClick={() => setReadable((current) => !current)}
      >
        {readable ? t('json.voirBrut') : t('json.rendreLisible')}
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
