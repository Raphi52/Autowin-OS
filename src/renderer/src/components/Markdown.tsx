/**
 * Rendu markdown LÉGER sans dépendance (sûr : pas de HTML injecté, on ne produit
 * que des éléments React). Gère : blocs ``` ```, `code` inline, **gras**, listes
 * `- `, et sauts de ligne. Suffisant pour des réponses de chat.
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
          <span key={i}>
            {block.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </span>
            ))}
          </span>
        )
      )}
    </div>
  )
}

/** `code` inline + **gras** dans une ligne. */
function inline(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>)
    else out.push(<strong key={k++}>{m[2]}</strong>)
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
