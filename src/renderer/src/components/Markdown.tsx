/**
 * Rendu markdown LÉGER sans dépendance (sûr : pas de HTML injecté, on ne produit
 * que des éléments React). Gère : blocs ``` ```, `code` inline, **gras**, liens
 * `[texte](http…)` + auto-liens http(s), listes `- `/`* `, et sauts de ligne.
 * Les liens ne sont créés que pour les schémas http/https (ouverts en externe par
 * le setWindowOpenHandler du main). Suffisant pour des réponses de chat.
 */
type MarkdownProps = {
  text: string
  highlightFinalSummary?: boolean
}

type FinalSummaryParts = {
  before: string
  summary: string
}

const FINAL_SUMMARY_LABELS = [
  /^✅\s+Fait(?:\s*:.*)?$/u,
  /^📍\s+Maintenant(?:\s*:.*)?$/u,
  /^⏳\s+Reste à faire(?:\s*:.*)?$/u,
  /^👉\s+Recommandé(?:\s*:.*)?$/u
]

export function Markdown({
  text,
  highlightFinalSummary = false
}: MarkdownProps): React.JSX.Element {
  const finalSummary = highlightFinalSummary ? splitFinalSummary(text) : null
  return (
    <div className="md">
      {finalSummary ? (
        <>
          {finalSummary.before && renderMarkdownBlocks(finalSummary.before, 'before')}
          <section className="md-final-summary" aria-label="Résumé final du modèle">
            {renderMarkdownBlocks(finalSummary.summary, 'summary')}
          </section>
        </>
      ) : (
        renderMarkdownBlocks(text, 'body')
      )}
    </div>
  )
}

function renderMarkdownBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/```/).map((block, i) =>
    i % 2 === 1 ? (
      <pre key={`${keyPrefix}-code-${i}`} className="md-code">
        <code>{block.replace(/^[a-zA-Z0-9]*\n/, '')}</code>
      </pre>
    ) : (
      <span key={`${keyPrefix}-text-${i}`}>{renderTextBlock(block)}</span>
    )
  )
}

function splitFinalSummary(text: string): FinalSummaryParts | null {
  const lines = text.split('\n')
  let inFence = false
  let markerIndex = -1
  let candidateIndex = -1
  let nextLabelIndex = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!inFence) {
      const labelIndex = FINAL_SUMMARY_LABELS.findIndex((pattern) => pattern.test(line.trim()))
      if (labelIndex === 0) {
        candidateIndex = index
        nextLabelIndex = 1
      } else if (labelIndex >= 0 && candidateIndex >= 0) {
        if (labelIndex === nextLabelIndex) {
          nextLabelIndex += 1
          if (nextLabelIndex === FINAL_SUMMARY_LABELS.length) {
            markerIndex = candidateIndex
            candidateIndex = -1
            nextLabelIndex = 0
          }
        } else {
          candidateIndex = -1
          nextLabelIndex = 0
        }
      }
    }

    const fences = line.match(/```/g)?.length ?? 0
    if (fences % 2 === 1) inFence = !inFence
  }

  if (markerIndex < 0) return null

  let beforeEnd = markerIndex
  let separatorIndex = markerIndex - 1
  while (separatorIndex >= 0 && lines[separatorIndex].trim() === '') separatorIndex -= 1
  if (separatorIndex >= 0 && lines[separatorIndex].trim() === '---') beforeEnd = separatorIndex

  return {
    before: lines.slice(0, beforeEnd).join('\n').replace(/\n+$/u, ''),
    summary: lines.slice(markerIndex).join('\n')
  }
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
