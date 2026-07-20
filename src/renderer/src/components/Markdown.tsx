/**
 * Rendu markdown LÉGER sans dépendance (sûr : pas de HTML injecté, on ne produit
 * que des éléments React). Gère : blocs ``` ```, `code` inline, **gras**, liens
 * `[texte](http…)` + auto-liens http(s), listes `- `/`* `, et sauts de ligne.
 * Les liens ne sont créés que pour les schémas http/https (ouverts en externe par
 * le setWindowOpenHandler du main). Suffisant pour des réponses de chat.
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = text.split(/```/)
  return (
    <div className="md">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="md-code">
            <code>{block.replace(/^[a-zA-Z0-9]*\n/, '')}</code>
          </pre>
        ) : (
          <span key={i}>{renderTextBlock(block)}</span>
        )
      )}
    </div>
  )
}

/** Rend un bloc de texte en groupant les lignes de liste `- `/`* ` en `<ul>`. */
function renderTextBlock(block: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let list: React.ReactNode[] | null = null
  let lastWasText = false
  let key = 0

  const flushList = (): void => {
    if (list) {
      out.push(
        <ul key={`ul-${key++}`} className="md-list">
          {list}
        </ul>
      )
      list = null
    }
  }

  for (const line of block.split('\n')) {
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (item) {
      lastWasText = false
      if (!list) list = []
      list.push(<li key={`li-${key++}`}>{inline(item[1])}</li>)
    } else {
      flushList()
      out.push(
        <span key={`ln-${key++}`}>
          {lastWasText && <br />}
          {inline(line)}
        </span>
      )
      lastWasText = true
    }
  }
  flushList()
  return out
}

/** `code` inline, **gras**, liens markdown et auto-liens http(s) dans une ligne. */
function inline(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)|`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[2] !== undefined) {
      out.push(
        <a key={k++} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>
      )
    } else if (m[3] !== undefined) {
      out.push(
        <a key={k++} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>
      )
    } else if (m[4] !== undefined) {
      out.push(<code key={k++}>{m[4]}</code>)
    } else {
      out.push(<strong key={k++}>{m[5]}</strong>)
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
