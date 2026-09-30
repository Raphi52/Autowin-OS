import { appendBrainTrace, type BrainTrace } from './activity/brain-trace-spool'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from './brain-corpus-scope'
import {
  retrieveBrainContext,
  type BrainRetrievalOptions,
  type BrainRetrievalResult
} from './brain-retrieval'
import { motsDe } from '../shared/mots'

/**
 * TITRES BRAIN DU TOUR — le chat consulte le Brain À CHAQUE TOUR, au plus bas coût possible.
 *
 * Pourquoi (conv-892, 2026-09-30 : « a chaque tour mais via un mecanisme qui coute le moins de
 * token possible »). Depuis le commit 3f35d512 (2026-07-29), le chat ne recevait plus rien du Brain :
 * il devait penser à lancer `brain_query`. Mesure sur les traces du 18/09 au 30/09 : 8 tours sur 824
 * l'ont fait, et jamais de lui-même (5 fois sur demande explicite, 3 fois imposé par /maintenance).
 *
 * Le moins cher qui reste « à chaque tour » : le CHEMIN des notes les plus proches (il porte leur
 * titre), jamais leur contenu. Le modèle ouvre en entier avec `brain_read` celles qui servent. Un tour sans note proche ne
 * reçoit RIEN : zéro caractère, pas même un en-tête. Le mode d'emploi du bloc vit dans le prompt de
 * pilotage (préfixe mis en cache), pas ici : le répéter à chaque tour le ferait payer à chaque tour.
 *
 * LE SEUIL EST MESURÉ, pas choisi. `brain/tooling/eval/rag-golden.json`, 27 questions, sur le Brain
 * vivant le 2026-09-30 : le score dense seul sépare mal (une question hors sujet atteint 0,38, une
 * pertinente descend à 0,33), le RANG sépare — hors sujet, la première note listée est au rang 7 ou
 * plus loin. Rang ≤ 3 et score ≥ 0,40 : bonne note dans le bloc pour 15 questions sur 24 (autant que
 * rang ≤ 5 ou score ≥ 0,30), 1,8 ligne en moyenne (le moins de toute la grille), 0 bloc sur les 3
 * questions hors sujet. Changer ces bornes = rejouer `scripts/sonde-titres-brain.mts`.
 */
export const TITRES_RANG_MAX = 3
export const TITRES_SCORE_MIN = 0.4
export const TITRES_MAX = 3
/** « ok », « go », « vas-y continue » ne portent pas de sujet : aucun appel. */
export const TITRES_MOTS_MIN = 3
/** Un tour n'attend pas le Brain plus longtemps (médiane mesurée ~430 ms). */
export const TITRES_DELAI_MS = 1_500
const TITRE_MAX_CARACTERES = 110
const REQUETE_MAX_CARACTERES = 2_000
/** Mémoire des notes déjà montrées : bornée, elle ne grossit pas avec la vie de l'app. */
const FILS_MEMORISES_MAX = 200
const NOTES_PAR_FIL_MAX = 150

export const POINT_TITRES_DU_TOUR = 'chat-titres-du-tour'
export const EN_TETE_TITRES = 'BRAIN — notes proches :'

export interface TitreBrain {
  path: string
  title: string
}

/**
 * Les notes à montrer : proches (rang et score), retenues par le serveur, pas déjà montrées dans ce
 * fil. Une note déjà listée à un tour précédent est dans l'historique de la session : la relister
 * ferait payer deux fois la même ligne.
 */
export function selectionnerTitres(
  resultat: BrainRetrievalResult,
  dejaMontres: ReadonlySet<string> = new Set()
): TitreBrain[] {
  const candidats = resultat.navigation?.candidates ?? []
  return candidats
    .filter(
      (c) =>
        c.retained &&
        c.rank <= TITRES_RANG_MAX &&
        c.denseCos >= TITRES_SCORE_MIN &&
        Boolean(c.path) &&
        !dejaMontres.has(c.path)
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TITRES_MAX)
    .map((c) => ({
      path: c.path.split('\\').join('/'),
      title: (c.title?.trim() || c.path).replace(/\s+/g, ' ').slice(0, TITRE_MAX_CARACTERES)
    }))
}

/**
 * Le CHEMIN seul, pas le titre : le nom de fichier d'une note curée EST son titre mis en slug
 * (`knowledge/lessons/salvage-trier-sur-le-contenu-pas-sur-le-diff-vs-main.md`), et c'est lui que
 * `brain_read` demande. Titre + chemin pesait ~200 caractères par ligne, le chemin seul ~105
 * (relevé sur 118 messages réels, 2026-09-30) : le titre doublait le prix pour la même information.
 */
export function rendreTitres(titres: readonly TitreBrain[]): string {
  if (titres.length === 0) return ''
  return [EN_TETE_TITRES, ...titres.map((t) => `- ${t.path}`)].join('\n')
}

interface OptionsTitresDuTour {
  /** Dossier de travail du fil : il fixe le corpus Brain autorisé, comme pour `brain_query`. */
  workspace?: (conversationId?: string) => string | undefined
  retrieve?: (query: string, options: BrainRetrievalOptions) => Promise<BrainRetrievalResult>
  onBrainTrace?: (trace: BrainTrace) => void
}

export function createBrainTitresDuTour(
  options: OptionsTitresDuTour = {}
): (query: string, meta?: { conversationId?: string; turnId?: string }) => Promise<string> {
  const retrieve = options.retrieve ?? retrieveBrainContext
  const emettreTrace = options.onBrainTrace ?? appendBrainTrace
  const montresParFil = new Map<string, Set<string>>()

  const memoriser = (conversationId: string, titres: readonly TitreBrain[]): void => {
    const deja = montresParFil.get(conversationId) ?? new Set<string>()
    montresParFil.delete(conversationId)
    for (const t of titres) deja.add(t.path)
    while (deja.size > NOTES_PAR_FIL_MAX) deja.delete(deja.values().next().value as string)
    montresParFil.set(conversationId, deja)
    while (montresParFil.size > FILS_MEMORISES_MAX) {
      montresParFil.delete(montresParFil.keys().next().value as string)
    }
  }

  return async (query, meta) => {
    const requete = query.trim().slice(0, REQUETE_MAX_CARACTERES)
    if (motsDe(requete).length < TITRES_MOTS_MIN) return ''
    const corpus = brainCorpusForWorkspace(options.workspace?.(meta?.conversationId))
    // Même fermeture que `brain_query` : un dossier sans corpus déclaré n'interroge rien.
    if (corpus?.length === 0) return ''
    const brut = await retrieve(requete, {
      ...(corpus ? { corpus } : {}),
      mode: 'candidates',
      timeoutMs: TITRES_DELAI_MS
    }).catch((): BrainRetrievalResult => ({
      context: '',
      status: 'unavailable',
      unavailableReason: 'network'
    }))
    const resultat = scopeBrainRetrieval(brut, corpus)
    const dejaMontres = meta?.conversationId ? montresParFil.get(meta.conversationId) : undefined
    const titres = selectionnerTitres(resultat, dejaMontres)
    const bloc = rendreTitres(titres)
    if (meta?.conversationId) {
      if (titres.length > 0) memoriser(meta.conversationId, titres)
      emettreTrace({
        timestamp: new Date().toISOString(),
        conversationId: meta.conversationId,
        ...(meta.turnId ? { turnId: meta.turnId } : {}),
        kind: 'pousse',
        point: POINT_TITRES_DU_TOUR,
        query: requete.slice(0, 300),
        found: titres.length > 0,
        status: resultat.status,
        injectedChars: bloc.length,
        ...(resultat.navigation ? { navigation: resultat.navigation } : {})
      })
    }
    return bloc
  }
}
