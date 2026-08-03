/**
 * Rendu markdown LÉGER sans dépendance (sûr : pas de HTML injecté, on ne produit
 * que des éléments React). Gère : blocs ``` ```, `code` inline, **gras**, liens
 * `[texte](http…)` + auto-liens http(s), listes `- `/`* `, tableaux GFM
 * (`| a | b |` + ligne séparatrice, alignement par `:`), et sauts de ligne.
 * Les liens ne sont créés que pour les schémas http/https (ouverts en externe par
 * le setWindowOpenHandler du main). Suffisant pour des réponses de chat.
 */
import { SandboxedHtmlPreview } from './SandboxedHtmlPreview'

type MarkdownProps = {
  text: string
  highlightFinalSummary?: boolean
}

type FinalSummaryParts = {
  before: string
  summary: string
}

const FINAL_SUMMARY_LABELS = [
  /^(?:#+\s*)?(?:\*\*)?✅️?\s+(?:\*\*)?Fait(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^(?:#+\s*)?(?:\*\*)?📍️?\s+(?:\*\*)?Maintenant(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^(?:#+\s*)?(?:\*\*)?⏳️?\s+(?:\*\*)?Reste à faire(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^(?:#+\s*)?(?:\*\*)?👉️?\s+(?:\*\*)?Recommandé(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u
]

/**
 * Extrait la RECOMMANDATION (ligne « 👉 Recommandé : … » du bloc de clôture) d'une réponse.
 * Rend le texte de l'étape recommandée (sans le libellé, sans le gras markdown), ou null.
 * Sert de ghost-text pré-rempli dans le composer du chat (accepté par Tab).
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec ce renderer
export function extractRecommendation(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('👉') || !/Recommand[ée]/u.test(line)) continue
    const m = line.match(/Recommand[ée]\**\s*(?:[:：]|[—–-])\s*(.+)$/u)
    const rec = (m ? m[1] : line.replace(/^👉\s*/u, ''))
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    return rec || null
  }
  return null
}

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

type FencedBlock = { kind: 'text' | 'code' | 'html-render'; content: string }

function tokenizeFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = []
  const opening = /^ {0,3}```([^\r\n]*)\r?\n/gm
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = opening.exec(text)) !== null) {
    if (match.index > cursor)
      blocks.push({ kind: 'text', content: text.slice(cursor, match.index) })
    const contentStart = opening.lastIndex
    const closing = /^ {0,3}```[ \t]*(?:\r?\n|$)/gm
    closing.lastIndex = contentStart
    const end = closing.exec(text)

    if (!end) {
      // Pendant le streaming, un fence non fermé reste une source inerte.
      blocks.push({ kind: 'code', content: text.slice(contentStart) })
      cursor = text.length
      break
    }

    const content = text.slice(contentStart, end.index).replace(/\r?\n$/u, '')
    const language = match[1].trim()
    blocks.push({
      kind: language === 'html-render' ? 'html-render' : 'code',
      content
    })
    cursor = closing.lastIndex
    opening.lastIndex = cursor
  }

  if (cursor < text.length) blocks.push({ kind: 'text', content: text.slice(cursor) })
  return blocks.length ? blocks : [{ kind: 'text', content: text }]
}

function renderMarkdownBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  return tokenizeFencedBlocks(text).map((block, index) => {
    if (block.kind === 'html-render')
      return (
        <SandboxedHtmlPreview key={`${keyPrefix}-html-render-${index}`} source={block.content} />
      )
    if (block.kind === 'code')
      return (
        <pre key={`${keyPrefix}-code-${index}`} className="md-code">
          <code>{block.content}</code>
        </pre>
      )
    return <span key={`${keyPrefix}-text-${index}`}>{renderTextBlock(block.content)}</span>
  })
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

type Align = 'left' | 'center' | 'right'

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR = /^\s*\|(?:\s*:?-{1,}:?\s*\|)+\s*$/

/** Découpe une ligne `| a | b |` en cellules (les `\|` échappés restent littéraux). */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function parseAlignments(separator: string): Align[] {
  return splitRow(separator).map((spec) => {
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

/**
 * Niveau d'une valeur de cellule pour la pastille : score numérique (`88`, `88/100`,
 * `88 %`) sur seuils 70/40, ou statut connu. `null` = pas de pastille.
 */
function badgeLevel(value: string): 'good' | 'warn' | 'bad' | null {
  const score = /^(\d{1,3})(?:\s*\/\s*100|\s*%)?$/.exec(value)
  if (score) {
    const n = Number(score[1])
    if (n > 100) return null
    return n >= 70 ? 'good' : n >= 40 ? 'warn' : 'bad'
  }
  const status = value
    .toUpperCase()
    .replace(/[✅⚠⛔🟢🟠🔴\s.]/gu, '')
    .replace(/\uFE0F/gu, '')
  if (!status) return null
  if (['GREEN', 'VERT', 'OK', 'PASS', 'FAIT', 'DONE'].includes(status)) return 'good'
  if (['WARN', 'ORANGE', 'DEGRADED', 'DEGRADE', 'PARTIEL', 'ENCOURS', 'FLAKY'].includes(status))
    return 'warn'
  if (['RED', 'ROUGE', 'FAIL', 'KO', 'BLOQUE', 'BLOQUÉ', 'INVALID'].includes(status)) return 'bad'
  return null
}

function renderCell(value: string): React.ReactNode {
  const level = badgeLevel(value)
  if (!level) return inline(value)
  return <span className={`md-badge md-badge-${level}`}>{value}</span>
}

/** Rend un tableau GFM (entête + séparateur + lignes) en `<table>`. */
function renderTable(rows: string[], keyPrefix: string): React.ReactNode {
  const headers = splitRow(rows[0])
  const aligns = parseAlignments(rows[1])
  const body = rows.slice(2).map(splitRow)
  const alignOf = (i: number): Align => aligns[i] ?? 'left'
  return (
    <div className="md-table-wrap" key={keyPrefix}>
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((cell, i) => (
              <th key={`th-${i}`} style={{ textAlign: alignOf(i) }}>
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={`tr-${r}`}>
              {headers.map((_, i) => (
                <td key={`td-${r}-${i}`} style={{ textAlign: alignOf(i) }}>
                  {renderCell(cells[i] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Rend un bloc de texte en groupant les listes `- `/`* ` en `<ul>` et les tableaux GFM. */
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

  const lines = block.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    // Tableau GFM : ligne d'entête + ligne séparatrice obligatoires.
    if (
      TABLE_ROW.test(line) &&
      index + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[index + 1])
    ) {
      flushList()
      const rows = [line, lines[index + 1]]
      let next = index + 2
      while (next < lines.length && TABLE_ROW.test(lines[next])) {
        rows.push(lines[next])
        next += 1
      }
      out.push(renderTable(rows, `tbl-${key++}`))
      lastWasText = false
      index = next - 1
      continue
    }

    // Titres markdown `#`…`######`.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      const Tag = `h${heading[1].length}` as 'h1'
      out.push(
        <Tag key={`h-${key++}`} className="md-h">
          {inline(heading[2])}
        </Tag>
      )
      lastWasText = false
      continue
    }

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
