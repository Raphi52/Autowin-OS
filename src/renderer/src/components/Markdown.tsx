/**
 * Rendu markdown LÉGER sans dépendance (sûr : pas de HTML injecté, on ne produit
 * que des éléments React). Gère : blocs ``` ```, `code` inline, **gras**, liens
 * `[texte](http…)` + auto-liens http(s), listes `- `/`* `, tableaux GFM
 * (`| a | b |` + ligne séparatrice, alignement par `:`), et sauts de ligne.
 * Les liens ne sont créés que pour les schémas http/https (ouverts en externe par
 * le setWindowOpenHandler du main). Suffisant pour des réponses de chat.
 */
import { memo } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import {
  authoritativeOrchestrationClosureSpan,
  markdownCodeLineProtection
} from '../../../shared/orchestration-outcome'
import { MAX_INLINE_HTML_CHARS, prepareChatHtml } from './chat-html-inline'
import { retirerLignePromptSuivant } from '../../../shared/prompt-suivant'
import { parseFileRef } from '../../../shared/file-ref'
import { createBoundedCache } from './bounded-cache'

type MarkdownProps = {
  text: string
  /** Fence ouverte dans un fragment texte précédent, séparé visuellement par une carte d'action. */
  continuationPrefix?: string
  highlightFinalSummary?: boolean
}

type FinalSummaryParts = {
  before: string
  summary: string
  /** Ce qui suit le bloc : rendu NORMALEMENT, hors du lisere, jamais perdu. */
  after: string
}

/**
 * LE DEPOUILLEMENT DU DECOR, avant toute reconnaissance de libelle.
 *
 * Signale par l'utilisateur : « des fois il s'affiche pas ». Deux formes reelles echappaient a la
 * detection, donc au lisere. La PUCE, d'abord : un bloc de cloture ecrit en liste n'etait pas vu.
 * Et surtout le bloc RETROGRADE par le main — sur un run non valide,
 * `demoteUnvalidatedSuccessClaims` remplace `✅ Fait` par `⚠️ Fait — AUTO-DECLARE`, et l'emoji
 * n'etait plus reconnu. Le cadre disparaissait donc exactement sur les reponses ou l'etat est le
 * plus important a lire.
 */
function sansDecorDeLibelle(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, '')
    .replace(/^#+\s*/u, '')
    .replace(/^(?:\*\*|__)/u, '')
    .trim()
}

/** `✅` sur un run livre, `⚠️` quand le main a retrograde l'etiquette : le meme bloc, deux etats. */
const MARQUE_FAIT = /^(?:✅|⚠)️?\s*(?:\*\*)?Fait(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u

const FINAL_SUMMARY_LABELS = [
  MARQUE_FAIT,
  /^📍️?\s*(?:\*\*)?Maintenant(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^⏳️?\s*(?:\*\*)?Reste à faire(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^👉️?\s*(?:\*\*)?Recommandé(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u
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

/**
 * MÉMOÏSATION DU RENDU — le fil se re-rend à chaque lot de deltas ; sans `memo`, les bulles déjà
 * figées repayaient un parse CommonMark complet à chaque frame alors que leur texte n'a pas bougé.
 * Les props sont des primitives : la comparaison superficielle de `memo` est ici exacte.
 */
export const Markdown = memo(function Markdown({
  text,
  continuationPrefix,
  highlightFinalSummary = false
}: MarkdownProps): React.JSX.Element {
  /*
   * La ligne technique du prompt suivant ne s AFFICHE jamais : elle ne sert qu a pre-garnir en grise
   * le champ de saisie. La retirer ici, au plus pres du rendu, evite de la filtrer dans chaque
   * appelant -- et de la laisser clignoter caractere par caractere pendant le streaming.
   */
  const brut = continuationPrefix ? `${continuationPrefix}\n${text}` : text
  const source = retirerLignePromptSuivant(brut)
  const finalSummary = highlightFinalSummary ? splitFinalSummary(source) : null
  return (
    <div className="md">
      {finalSummary ? (
        <>
          {finalSummary.before && renderMarkdownBlocks(finalSummary.before, 'before')}
          <section className="md-final-summary" aria-label="Résumé final du modèle">
            {renderMarkdownBlocks(finalSummary.summary, 'summary')}
          </section>
          {finalSummary.after && renderMarkdownBlocks(finalSummary.after, 'after')}
        </>
      ) : (
        renderMarkdownBlocks(source, 'body')
      )}
    </div>
  )
})

type MarkdownBlock = { kind: 'text' | 'code' | 'html-render'; content: string }

type MarkdownAstNode = {
  type?: string
  lang?: string | null
  value?: string
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: MarkdownAstNode[]
}

type MarkdownCodeSpan = {
  start: number
  end: number
  language: string | null
  content: string
  source: string
}

function hasClosingFence(source: string, content: string): boolean {
  const opening = /^(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/u.exec(source)
  if (!opening) return false
  const marker = opening[1][0]
  const length = opening[1].length
  const markerOnly = (line: string): boolean => {
    let candidate = line.trimStart()
    while (candidate.startsWith('>')) candidate = candidate.slice(1).trimStart()
    return new RegExp(`^${marker}{${length},}[ \\t]*$`, 'u').test(candidate)
  }
  // Le parseur exclut la vraie fermeture de `value`. Une pseudo-fermeture trop indentée reste au
  // contraire dans `value`. Comparer les comptes revient à demander au parseur — pas à une seconde
  // regex permissive — s'il a réellement consommé un délimiteur de fermeture.
  const sourceMarkers = source.split(/\r?\n/u).slice(1).filter(markerOnly).length
  const contentMarkers = content.split('\n').filter(markerOnly).length
  return sourceMarkers > contentMarkers
}

/**
 * Tokenisation CACHÉE par contenu : c'est elle qui appelle `fromMarkdown`. Deux rendus du MÊME
 * texte (re-rendu du fil, remontage, bulle figée) partagent donc le même découpage. Cache borné
 * (`createBoundedCache`) : le streaming crée une clé par lot de deltas, un cache infini fuirait.
 */
const tokenCache = createBoundedCache<MarkdownBlock[]>(120)

function tokenizeMarkdownCodeBlocks(text: string): MarkdownBlock[] {
  return tokenCache.get(text, computeMarkdownCodeBlocks)
}

function computeMarkdownCodeBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const spans: MarkdownCodeSpan[] = []
  let tree: MarkdownAstNode
  try {
    tree = fromMarkdown(text) as MarkdownAstNode
  } catch {
    // Une source que CommonMark ne peut pas projeter reste inerte plutôt que d'être interprétée
    // comme prose lifecycle ou comme HTML rendu.
    return [{ kind: 'code', content: text }]
  }

  const visit = (node: MarkdownAstNode): void => {
    if (node.type === 'code') {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      if (start !== undefined && end !== undefined && end >= start) {
        spans.push({
          start,
          end,
          language: node.lang ?? null,
          content: node.value ?? '',
          source: text.slice(start, end)
        })
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
  spans.sort((left, right) => left.start - right.start)

  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor) blocks.push({ kind: 'text', content: text.slice(cursor, span.start) })
    blocks.push({
      kind:
        span.language === 'html-render' &&
        hasClosingFence(span.source, span.content) &&
        !authoritativeOrchestrationClosureSpan(span.content)
          ? 'html-render'
          : 'code',
      content: span.content
    })
    cursor = span.end
  }

  if (cursor < text.length) blocks.push({ kind: 'text', content: text.slice(cursor) })
  return blocks.length ? blocks : [{ kind: 'text', content: text }]
}

function renderMarkdownBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  return tokenizeMarkdownCodeBlocks(text).map((block, index) => {
    if (block.kind === 'html-render' && block.content.length > MAX_INLINE_HTML_CHARS)
      return (
        // Trop volumineux pour etre injecte dans le fil. On le dit explicitement plutot que de le
        // laisser passer pour un bloc de code ordinaire : le modele a demande un RENDU, et savoir
        // qu'il a ete refuse — et pourquoi — vaut mieux qu'un silence.
        <details
          key={`${keyPrefix}-html-too-large-${index}`}
          className="md-html-oversize"
          data-testid="chat-inline-html-too-large"
        >
          <summary>
            Rendu HTML ignoré — {block.content.length.toLocaleString('fr-FR')} caractères, au-delà
            de la limite de {MAX_INLINE_HTML_CHARS.toLocaleString('fr-FR')}. Voir la source.
          </summary>
          <pre className="md-code">
            <code>{block.content}</code>
          </pre>
        </details>
      )

    if (block.kind === 'html-render') {
      const prepared = prepareChatHtml(block.content)
      return (
        // Rendu DANS le fil, pas dans une vignette. L'iframe precedente imposait une bordure, une
        // barre d'outils et une hauteur fixe qui scrollait : le contenu etait enferme dans une boite
        // au lieu d'embellir la reponse. Le prix de ce choix est que le HTML du modele vit desormais
        // dans le DOM de l'app — c'est `sanitizeChatHtml` qui porte seul cette frontiere.
        <div
          key={`${keyPrefix}-html-render-${index}`}
          className="md-html"
          data-testid="chat-inline-html"
          data-html-scope={prepared.scopeId}
          dangerouslySetInnerHTML={{ __html: prepared.html }}
        />
      )
    }
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
  const protectedLines = markdownCodeLineProtection([text])[0]
  let markerIndex = -1
  let candidateIndex = -1
  let nextLabelIndex = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!protectedLines.has(index + 1)) {
      const nu = sansDecorDeLibelle(line)
      const labelIndex = FINAL_SUMMARY_LABELS.findIndex((pattern) => pattern.test(nu))
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
  }

  if (markerIndex < 0) return null

  let beforeEnd = markerIndex
  let separatorIndex = markerIndex - 1
  while (separatorIndex >= 0 && lines[separatorIndex].trim() === '') separatorIndex -= 1
  if (separatorIndex >= 0 && lines[separatorIndex].trim() === '---') beforeEnd = separatorIndex

  /*
   * LA BORNE DE FIN, qui n'existait pas.
   *
   * Signale par l'utilisateur : « des fois il encadre tout ce qui vient apres la ligne
   * recommande ». `lines.slice(markerIndex)` prenait tout jusqu'au bout du texte : n'importe quelle
   * ligne ecrite apres la recommandation — une note, un avertissement d'Autowin, un bloc de code —
   * se retrouvait enfermee dans le lisere et presentee comme « resume final ».
   *
   * Le bloc s'arrete a la fin du PARAGRAPHE de la recommandation : sa ligne, plus celles qui la
   * suivent sans coupure (un conseil peut tenir sur deux lignes). La premiere ligne vide ferme.
   * Ce qui suit reste dans la reponse, simplement hors du cadre — jamais perdu.
   */
  const marqueRecommande = FINAL_SUMMARY_LABELS[FINAL_SUMMARY_LABELS.length - 1]
  let summaryEnd = lines.length
  for (let index = markerIndex; index < lines.length; index += 1) {
    if (!marqueRecommande.test(sansDecorDeLibelle(lines[index]))) continue
    let fin = index + 1
    while (fin < lines.length && lines[fin].trim() !== '') fin += 1
    summaryEnd = fin
    break
  }

  return {
    before: lines.slice(0, beforeEnd).join('\n').replace(/\n+$/u, ''),
    summary: lines.slice(markerIndex, summaryEnd).join('\n'),
    after: lines.slice(summaryEnd).join('\n').replace(/^\n+/u, '')
  }
}

type Align = 'left' | 'center' | 'right'

/**
 * Une ligne de tableau. Les pipes ENCADRANTS sont facultatifs : `a | b | c` est une forme GFM
 * parfaitement valide, et l'exiger faisait tomber le tableau ENTIER en texte brut — c'est ce qu'on
 * voyait quand un tableau de skill « n'affichait pas tout ». Reproduit par test avant correction.
 */
const TABLE_ROW = /^\s*[^|\n]*\|/
/** Le séparateur, pipes encadrants également facultatifs. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/

/**
 * Découpe une ligne `| a | b |` en cellules. Les `\|` échappés restent littéraux, et un pipe DANS du
 * code inline n'est pas un séparateur.
 *
 * Découpage manuel plutôt qu'un `split` : `` `git log | head` `` contient un pipe qui appartient à la
 * commande. Le traiter comme une frontière décalait toutes les colonnes suivantes d'un cran — ce qui
 * se voit comme des colonnes en trop, ou mal alignées. Reproduit par test avant correction.
 */
function splitRow(line: string): string[] {
  const texte = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cellules: string[] = []
  let courante = ''
  let dansCode = false
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i]
    if (c === '\\' && texte[i + 1] === '|') {
      courante += '|'
      i += 1
      continue
    }
    if (c === '`') dansCode = !dansCode
    if (c === '|' && !dansCode) {
      cellules.push(courante.trim())
      courante = ''
      continue
    }
    courante += c
  }
  cellules.push(courante.trim())
  return cellules
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
  // Le score arrive presque toujours EMPHASE (`**88**`, `` `88` ``) : les skills graissent la colonne
  // Score par convention. Tester la valeur brute faisait echouer le motif numerique sur les etoiles,
  // donc la pastille ne s'allumait JAMAIS en usage reel — la colonne sortait en texte plat.
  const value_ = value.replace(/^[*`_\s]+|[*`_\s]+$/gu, '')
  const score = /^(\d{1,3})(?:\s*\/\s*100|\s*%)?$/.exec(value_)
  if (score) {
    const n = Number(score[1])
    if (n > 100) return null
    return n >= 70 ? 'good' : n >= 40 ? 'warn' : 'bad'
  }
  const status = value_
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
  // La pastille PORTE deja l'emphase (fond colore, graisse) : garder les `**` du markdown les
  // afficherait litteralement a l'interieur.
  return <span className={`md-badge md-badge-${level}`}>{value.replace(/[*`_]/gu, '').trim()}</span>
}

/** Rend un tableau GFM (entête + séparateur + lignes) en `<table>`. */
function renderTable(rows: string[], keyPrefix: string): React.ReactNode {
  const headers = splitRow(rows[0])
  const aligns = parseAlignments(rows[1])
  const body = rows.slice(2).map(splitRow)
  const alignOf = (i: number): Align => aligns[i] ?? 'left'
  // Le nombre de colonnes est le MAXIMUM observe, pas la largeur de l'entete : itérer sur `headers`
  // faisait disparaitre sans le moindre bruit les cellules d'une ligne plus large que son entete.
  // Perdre une donnee en silence est pire que rendre une colonne sans titre.
  const columnCount = Math.max(headers.length, ...body.map((cells) => cells.length))
  const columns = Array.from({ length: columnCount }, (_, i) => i)
  return (
    <div className="md-table-wrap" key={keyPrefix}>
      <table className="md-table">
        <thead>
          <tr>
            {columns.map((i) => (
              <th key={`th-${i}`} style={{ textAlign: alignOf(i) }}>
                {inline(headers[i] ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={`tr-${r}`}>
              {columns.map((i) => (
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
  let listKind: 'ul' | 'ol' = 'ul'
  let listStart = 1
  let lastWasText = false
  let key = 0

  const flushList = (): void => {
    if (!list) return
    // Une liste numerotee doit rendre un `<ol>` : la traiter comme du texte nu faisait perdre a la
    // fois la numerotation et le retrait, ce qui aplatissait toute enumeration ordonnee.
    out.push(
      listKind === 'ol' ? (
        <ol key={`ol-${key++}`} className="md-list" start={listStart === 1 ? undefined : listStart}>
          {list}
        </ol>
      ) : (
        <ul key={`ul-${key++}`} className="md-list">
          {list}
        </ul>
      )
    )
    list = null
    listKind = 'ul'
    listStart = 1
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

    // Filet horizontal `---` / `***` / `___`. Sans ce cas, le separateur qui precede le bloc de
    // cloture s'affichait tel quel, en tirets nus au milieu de la reponse.
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList()
      out.push(<hr key={`hr-${key++}`} className="md-hr" />)
      lastWasText = false
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushList()
      out.push(
        <blockquote key={`bq-${key++}`} className="md-quote">
          {inline(quote[1])}
        </blockquote>
      )
      lastWasText = false
      continue
    }

    const ordered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line)
    const item = ordered ? null : /^\s*[-*]\s+(.*)$/.exec(line)
    if (ordered) {
      lastWasText = false
      if (!list || listKind !== 'ol') {
        flushList()
        list = []
        listKind = 'ol'
        listStart = Number(ordered[1])
      }
      list.push(<li key={`li-${key++}`}>{inline(ordered[2])}</li>)
    } else if (item) {
      lastWasText = false
      if (!list || listKind !== 'ul') {
        flushList()
        list = []
        listKind = 'ul'
      }
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

/**
 * `code` inline, **gras**, *italique*, ~~barre~~, liens markdown et auto-liens http(s) dans une ligne.
 *
 * La cible d'un lien markdown n'est plus restreinte a http(s). Les skills citent leurs preuves en
 * `[orchestrator.ts:80](src/main/orchestrator.ts:80)` : le motif http-seul ne matchait pas, donc la
 * ligne sortait LITTERALEMENT, crochets et parentheses compris, encombrant chaque cellule de tableau.
 * Une cible qui DESIGNE un fichier (`parseFileRef`) est maintenant cliquable : le clic passe par
 * `window.api.revealFile`, qui resout le chemin contre la racine du workspace COTE MAIN et ouvre le
 * fichier. Pas de `href` relatif (il se resoudrait contre l'origine de l'app) : on garde
 * `href="#"` + `preventDefault`. Une cible qui n'est pas un fichier (ancre, mailto, dossier) reste
 * rendue en `code`, ce qui supprime le bruit sans promettre un clic qui ne marcherait pas.
 */
/**
 * Reference de fichier citee par un agent. Cliquable UNIQUEMENT si la cible ressemble a un
 * fichier ; sinon on retombe sur l'ancien rendu `code` (aucun clic promis a tort).
 */
function FileRefLink({ label, target }: { label: string; target: string }): React.ReactElement {
  const ref = parseFileRef(target)
  if (!ref) return <code className="md-ref">{label}</code>
  return (
    <a
      className="md-ref md-ref-link"
      href="#"
      data-path={ref.path}
      data-line={ref.line === undefined ? undefined : String(ref.line)}
      title={ref.line === undefined ? ref.path : `${ref.path}:${ref.line}`}
      onClick={(e) => {
        e.preventDefault()
        void window.api?.revealFile?.(ref.path, ref.line)
      }}
    >
      {label}
    </a>
  )
}

function inline(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re =
    // L'italique exige un contenu COLLE a ses etoiles (`*mot*`), jamais espace : sans cette regle
    // de flanquement, une multiplication ecrite `2 * 3 * 4` devenait de l'italique.
    /\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s)]+)|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|(?<![\w*])\*(?![\s*])([^*\n]*[^\s*])\*(?!\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    if (m[2] !== undefined) {
      out.push(
        /^https?:\/\//i.test(m[2]) ? (
          <a key={k++} href={m[2]} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>
        ) : (
          <FileRefLink key={k++} label={m[1]} target={m[2]} />
        )
      )
    } else if (m[3] !== undefined) {
      out.push(
        <a key={k++} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>
      )
    } else if (m[4] !== undefined) {
      out.push(<code key={k++}>{m[4]}</code>)
    } else if (m[5] !== undefined) {
      out.push(<strong key={k++}>{m[5]}</strong>)
    } else if (m[6] !== undefined) {
      out.push(<del key={k++}>{m[6]}</del>)
    } else {
      out.push(<em key={k++}>{m[7]}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
