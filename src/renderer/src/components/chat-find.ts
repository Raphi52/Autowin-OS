/**
 * Recherche DANS le fil affiché — le « Ctrl+F » de la conversation.
 *
 * Pourquoi ce fichier et pas un filtre sur le tableau `messages` : le fil est mémoïsé exprès
 * (`filRendu`, ChatView.tsx) et un test compte les balayages par frappe
 * (`ChatView.frappe-cout.test.tsx`). Surligner en re-rendant les N messages à chaque caractère
 * rouvrirait le gel déjà réparé. On cherche donc dans le DOM DÉJÀ RENDU et on surligne par
 * l'API de surlignage CSS, qui peint sans toucher au DOM : coût de rendu React nul.
 *
 * Limite assumée : un terme coupé par une balise (« mo<b>t</b> ») n'est pas trouvé — la
 * recherche s'arrête à chaque nœud de texte.
 */
import { replierPourRecherche } from './conversation-search'

export type Occurrence = { debut: number; fin: number }

/** Nom des deux calques de peinture : toutes les occurrences, puis celle où l'on se trouve. */
export const CALQUE_TOUTES = 'chat-find'
export const CALQUE_ACTIVE = 'chat-find-actif'

/**
 * Positions du terme dans un texte, sur la forme repliée (« a jour » trouve « À jour »).
 *
 * Les positions valent pour le texte D'ORIGINE : la normalisation NFD ne retire que des
 * diacritiques combinants, jamais une lettre — même hypothèse que `segmentsSurlignes`.
 */
export function positionsDuTerme(texte: string, terme: string): Occurrence[] {
  const source = String(texte ?? '')
  const replie = replierPourRecherche(source)
  const cible = replierPourRecherche(terme).trim()
  if (!cible || !replie) return []
  const positions: Occurrence[] = []
  let curseur = replie.indexOf(cible)
  while (curseur >= 0) {
    positions.push({ debut: curseur, fin: curseur + cible.length })
    curseur = replie.indexOf(cible, curseur + cible.length)
  }
  return positions
}

const BALISES_MUETTES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

/**
 * Toutes les occurrences visibles sous `racine`, dans l'ordre de lecture.
 *
 * Ne descend pas dans ce que l'utilisateur ne lit pas : balises techniques et branches
 * `aria-hidden` (les pastilles décoratives du fil en portent).
 */
export function occurrencesDansLeDom(racine: Element | null, terme: string): Range[] {
  if (!racine) return []
  if (!replierPourRecherche(terme).trim()) return []
  const document = racine.ownerDocument
  if (!document) return []
  const parcours = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, {
    acceptNode: (noeud: Node) => {
      const parent = (noeud as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (BALISES_MUETTES.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      if (parent.closest?.('[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT
      return (noeud.nodeValue ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const trouvees: Range[] = []
  for (let noeud = parcours.nextNode(); noeud; noeud = parcours.nextNode()) {
    for (const { debut, fin } of positionsDuTerme(noeud.nodeValue ?? '', terme)) {
      const plage = document.createRange()
      plage.setStart(noeud, debut)
      plage.setEnd(noeud, fin)
      trouvees.push(plage)
    }
  }
  return trouvees
}

/** Rang suivant/précédent, en boucle. `-1` quand il n'y a rien à parcourir. */
export function indexSuivant(courant: number, total: number, pas: number): number {
  if (total <= 0) return -1
  const base = courant < 0 ? (pas > 0 ? -1 : 0) : courant
  return (((base + pas) % total) + total) % total
}

type RegistreSurlignage = {
  set: (nom: string, surlignage: unknown) => void
  delete: (nom: string) => void
}

type FenetreSurlignante = {
  CSS?: { highlights?: RegistreSurlignage }
  Highlight?: new (...plages: Range[]) => unknown
}

function registre(): {
  registre: RegistreSurlignage
  Highlight: NonNullable<FenetreSurlignante['Highlight']>
} | null {
  const global = globalThis as unknown as FenetreSurlignante
  const cible = global.CSS?.highlights
  const Highlight = global.Highlight
  if (!cible || typeof Highlight !== 'function') return null
  return { registre: cible, Highlight }
}

/**
 * Peint les occurrences. Rend `false` là où l'API de surlignage n'existe pas — la navigation
 * (défilement vers l'occurrence) continue de fonctionner, seule la couleur manque.
 */
export function peindreOccurrences(toutes: readonly Range[], active: Range | null): boolean {
  const api = registre()
  if (!api) return false
  api.registre.set(CALQUE_TOUTES, new api.Highlight(...toutes))
  api.registre.set(CALQUE_ACTIVE, active ? new api.Highlight(active) : new api.Highlight())
  return true
}

/** Retire toute peinture — appelé à la fermeture de la barre et au démontage. */
export function effacerPeinture(): void {
  const api = registre()
  if (!api) return
  api.registre.delete(CALQUE_TOUTES)
  api.registre.delete(CALQUE_ACTIVE)
}

/**
 * Amène une occurrence sous les yeux : déplie d'abord les blocs repliés qui la contiennent
 * (un résultat caché dans un `<details>` fermé ferait défiler vers du vide), puis fait défiler.
 */
export function revelerOccurrence(plage: Range | undefined): Element | null {
  if (!plage) return null
  const noeud = plage.startContainer
  const element = (noeud.nodeType === 1 ? noeud : noeud.parentElement) as Element | null
  if (!element) return null
  let repliant = element.closest?.('details') as HTMLDetailsElement | null
  while (repliant) {
    repliant.open = true
    repliant = repliant.parentElement?.closest?.('details') as HTMLDetailsElement | null
  }
  // `scrollIntoView` n'existe pas partout (environnements de test) : l'absence de défilement ne
  // doit pas casser la recherche.
  if (typeof (element as HTMLElement).scrollIntoView === 'function') {
    ;(element as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return element
}
