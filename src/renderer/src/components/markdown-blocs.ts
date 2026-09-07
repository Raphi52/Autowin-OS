/*
 * DECOUPAGE du Markdown en blocs (texte / code / html-render), avec reprise de streaming.
 *
 * Sorti de Markdown.tsx le 2026-09-07 : un fichier qui exporte a la fois un composant et des
 * fonctions casse le rechargement a chaud de React (regle react-refresh/only-export-components).
 * Le decoupage est du calcul pur — il n'a jamais eu besoin d'etre dans le fichier du composant.
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { authoritativeOrchestrationClosureSpan } from '../../../shared/orchestration-outcome'
import { createBoundedCache } from './bounded-cache'

export type MarkdownBlock = { kind: 'text' | 'code' | 'html-render'; content: string }

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

/**
 * REPRISE INCREMENTALE PENDANT LE STREAMING — le cache par contenu ne peut RIEN pour lui.
 *
 * Mesure du 2026-09-05 (conv-303) sur le plus long message reel du depot (76 ko) : analyse une
 * seule fois, il coute 14 ms ; analyse a chaque lot de texte recu, il en coute 1500 en 195
 * analyses, soit 107 fois plus. Le cache existant ne sert jamais ici puisque le texte GRANDIT :
 * chaque lot fabrique une cle neuve. Cote journal, 115 s de fenetre morte en « renderer:chat » et
 * « renderer:vue-chat » pour la seule journee du 04/09.
 *
 * CE QUI REND LA REPRISE SURE : un bloc de code deja FERME ne peut plus changer, quoi qu'on ajoute
 * apres lui — ajouter du texte a la fin n'a aucun moyen de rouvrir une cloture passee. La fin du
 * dernier bloc de code ferme est donc un point de reprise exact, et non une approximation. Tout ce
 * qui suit (prose en cours, fence encore ouverte) est reanalyse a chaque fois, comme avant.
 *
 * On ne garde qu'UN seul point de reprise, celui du dernier texte vu : le streaming n'ecrit qu'un
 * message a la fois, et memoriser plus ferait grossir la memoire sans rien servir.
 */
let repriseCourante: { prefixe: string; blocs: MarkdownBlock[] } | null = null

/** Efface le point de reprise — les tests s'en servent pour repartir d'un etat propre. */
export function oublierRepriseMarkdown(): void {
  repriseCourante = null
}

export function tokenizeMarkdownCodeBlocks(text: string): MarkdownBlock[] {
  return tokenCache.get(text, calculerBlocsAvecReprise)
}

/**
 * Analyse en repartant du dernier point sur, quand le texte ne fait que s'allonger.
 *
 * Le resultat est IDENTIQUE a une analyse complete : c'est l'invariant que tient le test dedie,
 * en comparant les deux sorties sur des textes qui grandissent lot par lot.
 */
export function calculerBlocsAvecReprise(text: string): MarkdownBlock[] {
  const reprise = repriseCourante
  if (reprise && reprise.prefixe.length > 0 && text.startsWith(reprise.prefixe)) {
    const queue = decouper(text.slice(reprise.prefixe.length))
    const blocs = [...reprise.blocs, ...queue.blocs]
    memoriserReprise(
      reprise.prefixe + text.slice(reprise.prefixe.length, reprise.prefixe.length + queue.sur),
      blocs,
      queue.blocsSurs + reprise.blocs.length
    )
    return blocs
  }
  const complet = decouper(text)
  memoriserReprise(text.slice(0, complet.sur), complet.blocs, complet.blocsSurs)
  return complet.blocs
}

function memoriserReprise(prefixe: string, blocs: MarkdownBlock[], blocsSurs: number): void {
  repriseCourante =
    prefixe.length > 0 ? { prefixe, blocs: blocs.slice(0, blocsSurs) } : repriseCourante
}

/**
 * L'ANALYSE COMPLETE, sans aucune reprise — la reference contre laquelle la version incrementale
 * doit rendre EXACTEMENT le meme decoupage. C'est l'invariant que verifie le test dedie.
 */
export function decouperMarkdownSansReprise(text: string): MarkdownBlock[] {
  return decouper(text).blocs
}

/**
 * Le decoupage brut, plus le point de reprise sur qu'il a rencontre.
 *
 * `sur` est la fin du dernier bloc de code FERME ; `blocsSurs` est le nombre de blocs qui tiennent
 * entierement avant ce point. Zero quand rien n'est encore clos.
 */
function decouper(text: string): { blocs: MarkdownBlock[]; sur: number; blocsSurs: number } {
  const blocks: MarkdownBlock[] = []
  const spans: MarkdownCodeSpan[] = []
  let tree: MarkdownAstNode
  try {
    tree = fromMarkdown(text) as MarkdownAstNode
  } catch {
    // Une source que CommonMark ne peut pas projeter reste inerte plutôt que d'être interprétée
    // comme prose lifecycle ou comme HTML rendu.
    return { blocs: [{ kind: 'code', content: text }], sur: 0, blocsSurs: 0 }
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
  let sur = 0
  let blocsSurs = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor) blocks.push({ kind: 'text', content: text.slice(cursor, span.start) })
    const ferme = hasClosingFence(span.source, span.content)
    blocks.push({
      kind:
        span.language === 'html-render' &&
        ferme &&
        !authoritativeOrchestrationClosureSpan(span.content)
          ? 'html-render'
          : 'code',
      content: span.content
    })
    cursor = span.end
    // Seule une cloture DEJA ecrite fige ce qui precede : une fence encore ouverte peut tout changer.
    if (ferme) {
      sur = span.end
      blocsSurs = blocks.length
    }
  }

  if (cursor < text.length) blocks.push({ kind: 'text', content: text.slice(cursor) })
  const blocs = blocks.length ? blocks : [{ kind: 'text' as const, content: text }]
  return { blocs, sur, blocsSurs }
}
