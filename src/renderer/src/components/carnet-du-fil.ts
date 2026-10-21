/**
 * CARNET VIVANT DU FIL (conv-1038, 2026-10-21) — le socle PUR du panneau `CarnetDuFil`.
 *
 * Constat du scout du même jour : les fils longs dérivent (p90 = 14 messages de l'utilisateur par
 * fil), et la mémoire du fil (« ce que tu as retenu », `session-memory-echo.ts`) n'existait que pour
 * l'agent — l'utilisateur ne la voyait pas et ne pouvait pas la corriger.
 *
 * Le carnet n'invente rien : il RELIT ce que le fil a déjà écrit. La dernière demande humaine
 * (`derniereDemandeHumaine`, la même ancre que le mode auto), les quatre rubriques de la dernière
 * clôture FINIE (`lignesDeRubrique`, intitulés lus exactement), la question à choix restée
 * ouverte, les fichiers touchés par le fil et les faits retenus. Une ligne barrée ou corrigée devient
 * un texte posé dans la saisie (`texteDeCorrection`) : il part avec le message suivant, visible.
 */
import type { Msg, AsstMsg } from './chat-view-types'
import { derniereDemandeHumaine, lignesDeRubrique } from './chat-auto-mode'
import { parseAskDecision } from './ask-choices'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'

export type RubriqueCarnet =
  | 'objectif'
  | 'question'
  | 'maintenant'
  | 'reste'
  | 'recommande'
  | 'fait'
  | 'retenu'
  | 'garde'
  | 'fichier'

export interface LigneCarnet {
  /** Stable d'un rendu à l'autre : c'est elle qui garde une ligne barrée barrée. */
  cle: string
  rubrique: RubriqueCarnet
  texte: string
  /** Titre EXACT du fait retenu : la clé de son retrait dans l'écho (`oublierFaitRetenu`). */
  titreRetenu?: string
}

export interface FaitRetenu {
  title: string
  body?: string
}

/** Libellés montrés à l'utilisateur, dans l'ordre d'affichage du panneau. */
export const LIBELLES_CARNET: Record<RubriqueCarnet, string> = {
  objectif: 'Objectif',
  question: 'Question en attente',
  maintenant: 'Maintenant',
  reste: 'Reste à faire',
  recommande: 'Recommandé',
  fait: 'Fait',
  retenu: 'Retenu par l’agent',
  garde: 'Gardé au compactage',
  fichier: 'Fichiers touchés'
}

/** Assez pour voir l'essentiel d'un coup d'œil ; le fil entier reste là pour le détail. */
const MAX_LIGNES_PAR_RUBRIQUE = 8
const MAX_CARACTERES_LIGNE = 220

function nettoyer(ligne: string): string {
  const nue = ligne
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*(?:[-*•–—]|\d+[.)])\s+/u, '')
    .replace(/^\[[ xX]\]\s+/u, '')
    .trim()
  return nue.length > MAX_CARACTERES_LIGNE ? `${nue.slice(0, MAX_CARACTERES_LIGNE - 1)}…` : nue
}

function texteDe(message: AsstMsg): string {
  return (message.parts ?? [])
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('\n')
}

function estFini(message: AsstMsg): boolean {
  return message.status !== 'streaming' && message.done !== false
}

/**
 * La dernière réponse FINIE qui porte une clôture. Un tour en cours ne vide pas le carnet : sans
 * cette règle, le panneau se viderait à chaque envoi, au moment même où l'on veut le relire.
 */
function derniereCloture(fil: readonly Msg[]): string | null {
  for (let rang = fil.length - 1; rang >= 0; rang -= 1) {
    const message = fil[rang]
    if (message.role !== 'assistant') continue
    const asst = message as AsstMsg
    if (!estFini(asst)) continue
    const texte = texteDe(asst)
    const aUneCloture = (['Fait', 'Maintenant', 'Reste à faire', 'Recommandé'] as const).some(
      (rubrique) => lignesDeRubrique(texte, rubrique, 'exacte').some((ligne) => ligne.trim() !== '')
    )
    if (aUneCloture) return texte
  }
  return null
}

/** Question à choix au BOUT du fil : un message de l'utilisateur après elle l'a répondue. */
function questionOuverte(fil: readonly Msg[]): string | null {
  const dernier = fil.at(-1)
  if (!dernier || dernier.role !== 'assistant') return null
  const decisions = ((dernier as AsstMsg).parts ?? []).flatMap((part) => {
    const decision = parseAskDecision(part as { kind: string })
    return decision ? [decision.question] : []
  })
  return decisions.at(-1) ?? null
}

/** Assez pour lire l'essentiel du résumé sans quitter le carnet ; le reste est COMPTÉ, jamais tu. */
const MAX_LIGNES_GARDEES = 12

export type EtatCompactage =
  | { etat: 'en-cours' }
  | {
      etat: 'fait'
      /** Messages d'avant la demande de compactage : l'agent ne les relit plus. */
      laisses: number
      /** Le début du résumé, ligne par ligne, tel que l'agent le relit. */
      garde: string[]
      /** Lignes du résumé au-delà de `garde` : elles restent lisibles dans le fil. */
      restantes: number
      /** Faux quand la réponse n'a aucun texte (tour raté) : l'agent repart quand même de là. */
      repondu: boolean
    }

/**
 * « COMPACTER MONTRE CE QUI EST GARDÉ » (conv-1038, 2026-10-21 — idée 5 du scout). Le bouton
 * Compacter était opaque : il envoie `COMPACT_REQUEST`, l'agent écrit un résumé, puis le processus
 * principal ne renvoie plus que ce résumé et la suite (`depuisDerniereCompaction`,
 * `chat-turn-messages.ts`). La mémoire de l'agent, elle, reste remise à chaque tour
 * (`sessionMemoryBlock`, `agent-pilot.ts`).
 *
 * MÊME RÈGLE QUE LA COUPE DU PRINCIPAL, sinon le carnet montrerait un résumé que l'agent ne relit
 * pas : la DERNIÈRE demande exacte (après `trim`) suivie d'une réponse. Cette réponse compte même
 * ratée — le principal coupe aussi — et le carnet le dit (`repondu`). Une demande encore sans
 * réponse finie est « en cours » : rien n'est gardé tant que le résumé s'écrit.
 * check: carnet-du-fil.compactage.test.ts — 9 cas rouges avant cette fonction (« compactageDuFil is
 * not a function »), dont 4 comparés à la sortie réelle de `depuisDerniereCompaction`.
 */
export function compactageDuFil(fil: readonly Msg[]): EtatCompactage | null {
  for (let rang = fil.length - 1; rang >= 0; rang -= 1) {
    const message = fil[rang]
    const contenu = (message as { content?: unknown }).content
    if (message.role !== 'user' || typeof contenu !== 'string') continue
    if (contenu.trim() !== COMPACT_REQUEST) continue
    const reponse = fil[rang + 1]
    if (!reponse) return { etat: 'en-cours' }
    // Le principal saute une demande que ne suit pas une réponse : on fait de même.
    if (reponse.role !== 'assistant') continue
    if (!estFini(reponse as AsstMsg)) return { etat: 'en-cours' }
    const lignes = texteDe(reponse as AsstMsg)
      .split(/\r?\n/u)
      .map((ligne) => nettoyer(ligne.replace(/^\s*#{1,6}\s+/u, '')))
      .filter((ligne) => ligne !== '' && ligne !== '---')
    return {
      etat: 'fait',
      laisses: rang,
      garde: lignes.slice(0, MAX_LIGNES_GARDEES),
      restantes: Math.max(0, lignes.length - MAX_LIGNES_GARDEES),
      repondu: lignes.length > 0
    }
  }
  return null
}

export function lignesDuCarnet(entree: {
  fil: readonly Msg[]
  retenus?: readonly FaitRetenu[]
  fichiers?: readonly string[]
}): LigneCarnet[] {
  const lignes: LigneCarnet[] = []
  const poser = (rubrique: RubriqueCarnet, textes: readonly string[]): void => {
    const vus = new Set<string>()
    for (const brut of textes) {
      const texte = nettoyer(brut)
      if (!texte || texte === '---' || vus.has(texte)) continue
      vus.add(texte)
      lignes.push({ cle: `${rubrique}:${vus.size - 1}`, rubrique, texte })
      if (vus.size >= MAX_LIGNES_PAR_RUBRIQUE) break
    }
  }

  // fix-ok: cause mesurée sur la capture réelle du 2026-10-21 (conv-1038) — la demande envoyée par
  // le bouton Compacter était lue comme la dernière demande humaine : l'Objectif devenait « Compacte
  // ce fil : … ». Elle n'est pas un objectif de l'utilisateur : le carnet la saute.
  const objectif = derniereDemandeHumaine(
    entree.fil.filter(
      (message) =>
        message.role !== 'user' ||
        (message as { content?: unknown }).content?.toString().trim() !== COMPACT_REQUEST
    )
  )
  if (objectif) poser('objectif', [objectif.replace(/\s+/gu, ' ')])
  const question = questionOuverte(entree.fil)
  if (question) poser('question', [question])

  const cloture = derniereCloture(entree.fil)
  if (cloture) {
    poser('maintenant', lignesDeRubrique(cloture, 'Maintenant', 'exacte'))
    poser('reste', lignesDeRubrique(cloture, 'Reste à faire', 'exacte'))
    poser('recommande', lignesDeRubrique(cloture, 'Recommandé', 'exacte'))
    poser('fait', lignesDeRubrique(cloture, 'Fait', 'exacte'))
  }

  for (const [rang, fait] of (entree.retenus ?? []).slice(-MAX_LIGNES_PAR_RUBRIQUE).entries()) {
    const corps = fait.body?.replace(/\s+/gu, ' ').trim()
    const texte = nettoyer(corps ? `${fait.title} — ${corps}` : fait.title)
    if (texte)
      lignes.push({ cle: `retenu:${rang}`, rubrique: 'retenu', texte, titreRetenu: fait.title })
  }

  // Le résumé gardé, ligne par ligne : barrer ou corriger une ligne le dit à l'agent, qui repart de
  // ce seul résumé. check: cas « le résumé gardé devient des lignes du carnet » du même test.
  const compactage = compactageDuFil(entree.fil)
  if (compactage?.etat === 'fait')
    for (const [rang, texte] of compactage.garde.entries())
      lignes.push({ cle: `garde:${rang}`, rubrique: 'garde', texte })

  poser('fichier', entree.fichiers ?? [])
  return lignes
}

/**
 * Le texte posé dans la saisie quand l'utilisateur barre (`nouveau` absent ou vide) ou corrige une
 * ligne. Il CITE la ligne : l'agent sait exactement ce qui est contesté, sans retrouver le passage.
 */
export function texteDeCorrection(ligne: LigneCarnet, nouveau?: string): string {
  const libelle = LIBELLES_CARNET[ligne.rubrique]
  const remplacement = nouveau?.trim()
  if (!remplacement)
    return `Carnet du fil — à oublier (${libelle}) : « ${ligne.texte} ». Ce n’est plus vrai : ne t’appuie plus dessus.`
  return `Carnet du fil — correction (${libelle}) : « ${ligne.texte} » devient « ${remplacement} ».`
}

export interface ResumeAbsence {
  /** Tours FINIS commencés après la dernière visite. */
  tours: number
  /** Fichiers distincts touchés par le fil après la dernière visite. */
  fichiers: number
  /** Le fil attend une réponse à une question à choix. */
  question: boolean
  /** Somme des coûts CONNUS de ces tours. Absent si aucun n'est connu. */
  coutUsd?: number
  /** Au moins un tour sans coût connu : le total est un minimum, et il est dit comme tel. */
  coutPartiel: boolean
}

/**
 * « PENDANT TON ABSENCE » — ce qui s'est passé dans le fil depuis la dernière fois qu'il a été ouvert.
 *
 * `vueA` est le repère de la pastille « non lu » (`conversation-seen.ts`) lu AVANT de marquer le fil
 * vu. Un tour commencé avant ce repère a été vu partir : il n'est pas compté. Fil jamais ouvert ou
 * rien de fini depuis : pas de carte (`null`). Le coût d'un tour n'est connu que s'il a été reçu en
 * direct (`coutUsd` n'est pas conservé sur disque) : un total partiel le DIT, il n'est jamais
 * présenté comme complet.
 */
export function resumeDAbsence(entree: {
  fil: readonly Msg[]
  vueA: number | undefined
  traces: readonly { timestamp: string; paths: readonly string[] }[]
}): ResumeAbsence | null {
  const { vueA } = entree
  if (vueA === undefined) return null
  const tours = entree.fil.filter((message): message is AsstMsg => {
    if (message.role !== 'assistant') return false
    const asst = message as AsstMsg & { ts?: number }
    const debut = asst.debutDuTour ?? asst.ts
    return typeof debut === 'number' && debut > vueA && estFini(asst)
  })
  if (tours.length === 0) return null
  const fichiers = new Set<string>()
  for (const trace of entree.traces) {
    if (Date.parse(trace.timestamp) > vueA) for (const chemin of trace.paths) fichiers.add(chemin)
  }
  const couts = tours
    .map((tour) => tour.coutUsd)
    .filter((cout): cout is number => typeof cout === 'number' && Number.isFinite(cout))
  const coutUsd = couts.length > 0 ? couts.reduce((somme, cout) => somme + cout, 0) : undefined
  return {
    tours: tours.length,
    fichiers: fichiers.size,
    question: questionOuverte(entree.fil) !== null,
    ...(coutUsd !== undefined ? { coutUsd: Math.round(coutUsd * 10_000) / 10_000 } : {}),
    coutPartiel: couts.length < tours.length
  }
}
