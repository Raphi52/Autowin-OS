import { appendBrainTrace, type BrainTrace } from './activity/brain-trace-spool'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from './brain-corpus-scope'
import {
  retrieveBrainContext,
  type BrainRetrievalOptions,
  type BrainRetrievalResult
} from './brain-retrieval'
import { PREFIXE_NOTE_PERSO } from './brain-perso'
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
 * LE SEUIL EST MESURÉ, pas choisi. `entreprise/<nom>/brain/eval/rag-golden.json`, 27 questions, sur le Brain
 * vivant le 2026-09-30 : le score dense seul sépare mal (une question hors sujet atteint 0,38, une
 * pertinente descend à 0,33), le RANG sépare — hors sujet, la première note listée est au rang 7 ou
 * plus loin. Rang ≤ 3 et score ≥ 0,40 : bonne note dans le bloc pour 15 questions sur 24 (autant que
 * rang ≤ 5 ou score ≥ 0,30), 1,8 ligne en moyenne (le moins de toute la grille), 0 bloc sur les 3
 * questions hors sujet. Changer ces bornes = rejouer `scripts/sonde-titres-brain.mts`.
 *
 * BORNES CONFIRMÉES SUR L'USAGE RÉEL (conv-1303, 2026-10-30) : `scripts/banc-notes-proches-usage.mjs`
 * rejoue d'autres tris sur 822 tours servis et compte les notes réellement ouvertes. Aucun ne fait
 * mieux pour le même nombre de lignes (sans seuil : +2 ouvertures pour 2× les lignes ; score mêlé
 * aux mots du titre : moins bien). Les notes ouvertes HORS du bloc étaient à 57 sur 75 absentes des
 * candidats.
 *
 * LA REQUÊTE RESTE LE MESSAGE ENTIER (conv-1303, 2026-10-30, `scripts/banc-notes-proches-requete.mts`,
 * 825 tours rejoués sur le Brain vivant) : notes ouvertes couvertes 54/153 avec le message entier,
 * 25 avec ses mots-clés, 23 avec les mots-clés + le 1er ou le précédent message du fil, 59 avec
 * l'union message + mots-clés mais pour 35 % de lignes en plus. Ces 57 notes, l'agent les a trouvées
 * par SA recherche `brain_query`, reformulée par sens (« /draft » → « préférences visuelles »), et
 * dans sa liste longue (67 sur 75), pas dans un bloc de 3 (20 sur 75) : aucune réécriture du message
 * ne les aurait servies. Le bloc et `brain_query` se complètent, comme prévu.
 *
 * BRAIN PERSO (conv-1233, 2026-10-28, demande utilisateur : « étends le Brain perso aux notes
 * proches servies à chaque tour »). S'il est réglé, il est interrogé EN MÊME TEMPS que celui de
 * l'équipe (le tour n'attend pas plus), avec les mêmes bornes, et ses notes arrivent sous le même
 * en-tête avec le préfixe `perso:` — celui que `brain_read` reconnaît pour ouvrir la note dans le
 * bon Brain. Jusqu'à 3 notes de chaque Brain. Limite connue : les bornes ont été mesurées sur le
 * Brain d'équipe ; dans un petit Brain perso, le rang ≤ 3 laisse presque tout passer et seul le
 * score ≥ 0,40 trie.
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

/**
 * MESSAGES COMPOSÉS PAR L'APP, SANS SUJET PROPRE — aucune recherche (conv-1303, 2026-10-30).
 *
 * La requête est le message entier. Pour ces trois messages, il ne décrit que la MÉCANIQUE de l'app
 * (une tâche de fond rendue, des lots finis, la fin d'une chaîne) : la recherche ramenait les notes
 * sur cette mécanique, pas sur la tâche. Mesure du 22 au 30/10 (spool × turn-journals) : reprise
 * automatique 1 bloc lu sur 24, réveil de plan de lots 0 sur 12, fin de chaîne du mode auto 0 sur 3,
 * et les notes « plan de lots » servies 46 fois sans une ouverture. Le prompt d'un LOT et l'ordre
 * d'un autre fil portent, eux, une vraie tâche : ils restent interrogés.
 *
 * Copies des en-têtes de leurs producteurs, épinglées par le test : `ENTETE_REPRISE_AUTOMATIQUE`
 * (`chat/relance-taches-de-fond.ts`), `promptDeReveil` (`shared/plan-de-lots.ts`), `DEBUT_RELEVE`
 * (`renderer/.../chat-auto-mode.ts`). Copiées plutôt qu'importées : le premier tire le lanceur de
 * processus, le dernier vit côté interface.
 */
export const DEBUTS_SANS_SUJET_PROPRE: readonly string[] = [
  '[Reprise automatique]',
  'RÉVEIL DU PLAN DE LOTS « ',
  'La chaîne de ce fil est terminée. Ne lance aucun chantier'
]

export function messageSansSujetPropre(message: string): boolean {
  const texte = message.trimStart()
  return DEBUTS_SANS_SUJET_PROPRE.some((debut) => texte.startsWith(debut))
}

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
  dejaMontres: ReadonlySet<string> = new Set(),
  /** `perso:` pour les notes du Brain perso (conv-1233) : porté par le chemin rendu ET mémorisé. */
  prefixe = ''
): TitreBrain[] {
  const candidats = resultat.navigation?.candidates ?? []
  const cheminRendu = (path: string): string => `${prefixe}${path.split('\\').join('/')}`
  return candidats
    .filter(
      (c) =>
        c.retained &&
        c.rank <= TITRES_RANG_MAX &&
        c.denseCos >= TITRES_SCORE_MIN &&
        Boolean(c.path) &&
        !dejaMontres.has(prefixe ? cheminRendu(c.path) : c.path)
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TITRES_MAX)
    .map((c) => ({
      path: cheminRendu(c.path),
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
  /**
   * Environnement du Brain PERSO (`envDuBrainPerso`), ou `undefined` sans Brain perso. Relu à
   * CHAQUE tour : un Brain perso réglé dans les Réglages sert dès le tour suivant.
   */
  brainPerso?: () => NodeJS.ProcessEnv | undefined
  /** Le serveur perso n'écoute pas (connexion refusée) : l'appelant tente de le démarrer. */
  persoInjoignable?: () => void
  /**
   * Traces Brain déjà écrites (`readBrainTraces`), relues UNE fois au premier appel pour rebâtir
   * les notes déjà montrées par fil. Absent = mémoire vierge (tests).
   */
  relireTraces?: () => readonly BrainTrace[]
}

/**
 * Notes servies par une trace de ce point : son champ `notes` (exact, depuis conv-1303), sinon la
 * même sélection rejouée sur la navigation qu'elle a gardée (traces plus anciennes).
 */
export function notesServiesParTrace(trace: BrainTrace): string[] {
  if (trace.point !== POINT_TITRES_DU_TOUR || !(trace.injectedChars > 0)) return []
  if (trace.notes) return trace.notes
  if (!trace.navigation) return []
  return selectionnerTitres({ context: '', status: 'found', navigation: trace.navigation }).map(
    (t) => t.path
  )
}

/** Dossier sans corpus Brain déclaré : l'équipe n'est pas interrogée (même fermeture que brain_query). */
const EQUIPE_FERMEE: BrainRetrievalResult = { context: '', status: 'empty' }

export function createBrainTitresDuTour(
  options: OptionsTitresDuTour = {}
): (query: string, meta?: { conversationId?: string; turnId?: string }) => Promise<string> {
  const retrieve = options.retrieve ?? retrieveBrainContext
  const emettreTrace = options.onBrainTrace ?? appendBrainTrace
  const montresParFil = new Map<string, Set<string>>()
  let tracesRelues = false

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

  /**
   * MÉMOIRE QUI SURVIT AU REDÉMARRAGE (conv-1303, 2026-10-30) : elle ne vivait qu'en RAM, et
   * 137 lignes ont été resservies dans un fil qui les avait déjà reçues (13-30/10). Le spool garde
   * chaque bloc servi : le relire une fois (~40 ms pour 1 900 traces) suffit, sans second fichier.
   */
  const relireUneFois = (): void => {
    if (tracesRelues || !options.relireTraces) return
    tracesRelues = true
    let traces: readonly BrainTrace[] = []
    try {
      traces = options.relireTraces()
    } catch {
      return
    }
    // Les plus anciennes d'abord : les bornes de `memoriser` gardent alors les plus récentes.
    const chronologiques = [...traces].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    )
    for (const trace of chronologiques) {
      const notes = notesServiesParTrace(trace)
      if (notes.length > 0 && trace.conversationId) {
        memoriser(
          trace.conversationId,
          notes.map((path) => ({ path, title: path }))
        )
      }
    }
  }

  return async (query, meta) => {
    const requete = query.trim().slice(0, REQUETE_MAX_CARACTERES)
    if (motsDe(requete).length < TITRES_MOTS_MIN) return ''
    if (messageSansSujetPropre(requete)) return ''
    relireUneFois()
    const corpus = brainCorpusForWorkspace(options.workspace?.(meta?.conversationId))
    const envPerso = options.brainPerso?.()
    // Même fermeture que `brain_query` : un dossier sans corpus déclaré n'interroge rien de
    // l'équipe. Le Brain perso, rangé par aucun projet, reste interrogé.
    const equipeFermee = corpus?.length === 0
    if (equipeFermee && !envPerso) return ''
    const echec = (): BrainRetrievalResult => ({
      context: '',
      status: 'unavailable',
      unavailableReason: 'network'
    })
    const debut = performance.now()
    // Lancée AVANT d'attendre l'équipe : les deux recherches tournent en même temps.
    const persoEnCours = envPerso
      ? retrieve(requete, { env: envPerso, mode: 'candidates', timeoutMs: TITRES_DELAI_MS }).catch(
          echec
        )
      : undefined
    const brut = equipeFermee
      ? EQUIPE_FERMEE
      : await retrieve(requete, {
          ...(corpus ? { corpus } : {}),
          mode: 'candidates',
          timeoutMs: TITRES_DELAI_MS
        }).catch(echec)
    const brutPerso = await persoEnCours
    const durationMs = Math.round(performance.now() - debut)
    if (brutPerso?.status === 'unavailable' && brutPerso.unavailableReason === 'network') {
      options.persoInjoignable?.()
    }
    const resultat = scopeBrainRetrieval(brut, corpus)
    const dejaMontres = meta?.conversationId ? montresParFil.get(meta.conversationId) : undefined
    // Mêmes règles pour le perso : sources signées seules, jamais `inbox/`, aucun filtre de projet.
    const titresPerso = brutPerso
      ? selectionnerTitres(
          scopeBrainRetrieval(brutPerso, undefined),
          dejaMontres,
          PREFIXE_NOTE_PERSO
        )
      : []
    const titres = [...selectionnerTitres(resultat, dejaMontres), ...titresPerso]
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
        // Le statut est celui de l'équipe, sauf quand des notes perso ont été servies.
        status: titresPerso.length > 0 ? 'found' : resultat.status,
        ...(resultat.unavailableReason ? { unavailableReason: resultat.unavailableReason } : {}),
        durationMs,
        injectedChars: bloc.length,
        ...(resultat.navigation ? { navigation: resultat.navigation } : {}),
        ...(titres.length > 0 ? { notes: titres.map((t) => t.path) } : {})
      })
    }
    return bloc
  }
}
