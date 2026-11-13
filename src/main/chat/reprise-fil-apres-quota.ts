/**
 * UN FIL COUPÉ PAR LE QUOTA REPART SEUL, UNE FOIS (2026-11-01, repris de Paperclip).
 *
 * Mesuré sur 30 jours : 21 tours coupés dans 15 fils, dont 16 suivis d'un « reprend » tapé à la main,
 * 51 à 59 min après dans les cas récents. Les runs repartent déjà seuls à l'heure annoncée
 * (`runs/reveil-apres-quota.ts`) ; pas les fils. L'utilisateur revient ici sur le choix du 05/09
 * (« reprendre coûte du quota, donc c'est un clic ») en lançant ce travail. Le bouton reste.
 *
 * Quatre bornes tiennent le coût :
 * - UN SEUL ESSAI : le message de reprise s'écrit dans le fil, et c'est lui qu'on relit. La borne
 *   survit donc au redémarrage, là où la mémoire du réveil (`reveilles`) disparaît avec le processus ;
 * - un fil à la fois, dans une file À PART : elle attend la fin de chaque tour, et un long tour ne
 *   doit pas retenir le réveil d'un run ;
 * - jamais par-dessus quelqu'un : tout est relu au moment de partir, dans la file ;
 * - une coupure, un départ : une branche posée sur le tour coupé ne repart pas à côté de son fil.
 *
 * Et une borne tient les droits : seul un tour ouvert depuis le chat repart. La reprise n'a ni la
 * lecture seule, ni le budget, ni le plafond d'itérations d'un tour de règle, et l'historique d'une
 * règle contient un mail, texte non fiable qui n'a jamais dû ouvrir un tour sans bornes
 * (`chat-dispatch.ts`).
 *
 * fix-ok: rien ne lisait l'origine du tour coupé : le fil « Assistant mails » (coupé pendant un
 * mail) sortait « attente » à l'essai du contrôle final, comme une règle sur le vrai tour et le vrai
 * stockage (`run-pilot-chat.origine-du-tour.test.ts`, rouge avant cette lecture).
 *
 * `etatDeRepriseDuFil` décide pour le réveil ET pour la liste des conversations. Il n'écrit rien :
 * recalculé à la lecture, il ne touche pas la date de dernière touche du fil (leçon du 07/09 sur les
 * refus de reprise).
 *
 * Une même règle ne suffisait pas à tenir l'annonce : le réveil ne relisait les fils qu'au démarrage et
 * à la fin d'un tour en échec.
 *
 * fix-ok: fil coupé et marqué inactif, puis réactivé : `attente` à l'écran, 0 minuterie et 0 départ
 * (essai du contrôle final sur `creerRepriseDesFils`). Un plan fini et un run disparu
 * donnaient la même chose. `surveillerEncore` garde donc un passage prévu tant qu'un fil peut repartir :
 * au plus un quart d'heure après un tel changement, et aussitôt pour une réactivation (`index.ts`).
 *
 * Deux écarts restent. Dans une instance de test, l'écran annonce et rien ne part : `index.ts` y coupe
 * le réveil, pas l'état, dont les captures ont besoin. Et un tour qui JETTERAIT avant d'écrire sa marque
 * resterait annoncé jusqu'au redémarrage : aucune sortie `ok: false` n'existe avant `beginTurn`
 * (`run-pilot-chat.ts`), seule une exception y mène (`guardString`), et ce cas n'est pas mesuré.
 *
 * Dépendances injectées, pour que le test à horloge simulée observe les tours eux-mêmes.
 *
 * fix-ok: mesuré sur 30 jours dans les conversations : 21 tours coupés, 16 suivis d'un « reprend »
 * tapé à la main, parce qu'aucun réveil ne visait les fils (seuls les runs en avaient un).
 */
import { CONTINUATION_INSTRUCTION } from './chat-continuation'
import {
  MARGE_APRES_RETOUR_MS,
  creerReveilApresQuota,
  type RunSuspenduParQuota
} from '../runs/reveil-apres-quota'
import {
  MARQUE_REPRISE_APRES_QUOTA,
  estTourCoupeParQuota,
  estUneRepriseApresQuota,
  instantDeRetourAnnonce,
  tourDuFil,
  type EtatDeRepriseDuFil,
  type RaisonDeRepriseManuelle
} from '../../shared/reprise-quota'
import type { ChatTurnRuntime } from '../../shared/chat-turn'

/** Passé ce délai après l'heure annoncée, l'intention est périmée : l'utilisateur tranchera. */
export const VALIDITE_DE_LA_REPRISE_MS = 24 * 3_600_000

/**
 * Les runs à reprendre se lisent sur le disque, de façon synchrone, sur le fil principal. La liste
 * des conversations se rafraîchit à chaque tour : sans cette mémoire, un fil coupé y ajouterait une
 * lecture à chaque fois (gels mesurés le 04/09 sur ces mêmes fichiers).
 */
const MEMOIRE_DES_RUNS_MS = 60_000

/** Ce que la règle lit d'un fil — un sous-ensemble de `Conversation`. */
export interface FilLu {
  id: string
  inactive?: boolean
  messages: readonly {
    role: 'user' | 'assistant'
    content: string
    ts?: number
    status?: string
    error?: string
    orientation?: boolean
    parts?: readonly unknown[]
    runtime?: ChatTurnRuntime
    /** Posé par `fork` sur un tour copié : le fil qui possède vraiment ce tour. */
    turnConversationId?: string
  }[]
}

const contientOrchestrate = (parts: readonly unknown[] | undefined): boolean =>
  (parts ?? []).some(
    (part) =>
      Boolean(part) &&
      typeof part === 'object' &&
      (part as { kind?: unknown }).kind === 'action' &&
      (part as { name?: unknown }).name === 'orchestrate'
  )

/** La dernière demande est-elle déjà notre essai ? Une consigne glissée pendant le tour n'en est pas une. */
function essaiDejaFait(messages: FilLu['messages']): boolean {
  for (let rang = messages.length - 1; rang >= 0; rang -= 1) {
    const message = messages[rang]
    if (message.role === 'user' && !message.orientation)
      return estUneRepriseApresQuota(message.content)
  }
  return false
}

/**
 * Où en est ce fil. `undefined` : il n'est pas coupé par le quota, ou plus. Le tour coupé doit être le
 * DERNIER message hors consignes : une demande arrivée après lui a repris la main. Une consigne, elle,
 * ne reprend rien : elle part avec l'historique, et le tour relancé la traite
 * (`orientationsDuTourPrecedent`).
 */
export function etatDeRepriseDuFil(entree: {
  fil: FilLu
  maintenant: number
  /** Fonctions, pas valeurs : tous les fils passent ici, et seul un fil coupé en a besoin. */
  planDeLots: () => boolean
  /** Celle-ci lit le disque. */
  runAReprendre: () => boolean
}): EtatDeRepriseDuFil | undefined {
  const { fil, maintenant, planDeLots, runAReprendre } = entree
  const coupe = tourDuFil(fil.messages)
  // fix-ok: cause lue dans le code — chat.ts relisait l'historique de chaque fil pour la reprise. Ce même
  // test est le drapeau du résumé (`dernierTourCoupeParQuota`) : `filsCoupesALire` ne lit que les fils retenus.
  if (coupe === undefined || !estTourCoupeParQuota(coupe)) return undefined
  if (essaiDejaFait(fil.messages)) return { etat: 'essai-rate' }
  const aLaMain = (raison: RaisonDeRepriseManuelle): EtatDeRepriseDuFil => ({
    etat: 'manuelle',
    raison
  })
  if (fil.inactive) return aLaMain('inactive')
  // Le contrat des plans de lots dit « jamais automatique » (`plans-de-lots-app.ts`, `reprendre`).
  if (planDeLots()) return aLaMain('plan-de-lots')
  // Mesuré : 2 coupures sur 21. Le run a son propre réveil, relancer le fil paierait deux fois.
  if (contientOrchestrate(coupe.parts) || runAReprendre()) return aLaMain('run')
  // fix-ok: `fork` recopie le tour coupé avec son statut, son erreur et sa marque : une coupure et sa
  // branche donnaient deux fils coupés, donc deux tours payés (`partis ["conv-1","conv-2"]`, et
  // `[ 'branche', 'origine' ]` avec le vrai `fork`). Le fait se lit sur le tour, pas sur le fil : un
  // tour coupé DANS la branche, lui, est le sien et repart. `!== undefined` : un champ vide n'est
  // pas un accord. Placé avant l'origine : pour une copie, c'est ce qu'on sait de plus précis.
  if (coupe.turnConversationId !== undefined) return aLaMain('branche')
  // `=== true` : une marque absente ou illisible ne vaut pas accord. Accepter ce tour-là, plutôt que
  // refuser les règles une à une, couvre aussi les anciens tours et tout futur lanceur de fond.
  // Après le plan et le run : leurs tours viennent aussi du fond, et leur raison est plus précise.
  if (coupe.runtime?.ouvertDepuisLeChat !== true) return aLaMain('hors-du-chat')
  // Depuis la COUPURE, pas depuis maintenant : lu le lendemain, « resets 11pm » viserait un autre soir.
  const retour =
    typeof coupe.ts === 'number'
      ? instantDeRetourAnnonce(coupe.error, new Date(coupe.ts))
      : undefined
  if (retour === undefined) return aLaMain('aucune-heure')
  if (maintenant >= retour + VALIDITE_DE_LA_REPRISE_MS) return aLaMain('coupure-ancienne')
  return { etat: 'attente', reprendA: retour + MARGE_APRES_RETOUR_MS }
}

/** Le message écrit dans le fil : sa marque est la borne « un seul essai ». */
export function composerMessageDeReprise(): string {
  return `${MARQUE_REPRISE_APRES_QUOTA}\n${CONTINUATION_INSTRUCTION}`
}

export interface DependancesDeLaReprise {
  /** Les fils à examiner, avec leurs messages : ceux que `filsCoupesALire` retient. */
  lireFils: () => readonly FilLu[]
  /** Un fil précis, quel que soit son état : son départ se relit tel quel, comme avant le filtre. */
  lireFil: (id: string) => FilLu | undefined
  filOccupe: (id: string) => boolean
  filDansUnPlan: (id: string) => boolean
  /** Les fils qui ont un run à reprendre. Lecture disque : voir `MEMOIRE_DES_RUNS_MS`. */
  filsAvecRunAReprendre: () => ReadonlySet<string>
  mettreEnFile: (tache: () => Promise<void>) => Promise<void>
  /** Ouvre un tour normal : `messages` finit par le message de reprise, que le tour enregistre. */
  lancerTour: (
    id: string,
    messages: { role: 'user' | 'assistant'; content: string }[]
  ) => Promise<{ ok: boolean; error?: string }>
  journal?: (message: string) => void
}

/**
 * Les fils que la reprise relit avec leurs messages. Le résumé écarte les autres : leur premier test
 * (`etatDeRepriseDuFil`) échouerait sans rien lire de plus. `get` rend le fil entier, archivé compris.
 */
export function filsCoupesALire(magasin: {
  listResumes: () => readonly { id: string; dernierTourCoupeParQuota?: true }[]
  get: (id: string) => FilLu | undefined
}): FilLu[] {
  return magasin.listResumes().flatMap((resume) => {
    if (resume.dernierTourCoupeParQuota !== true) return []
    const fil = magasin.get(resume.id)
    return fil ? [fil] : []
  })
}

export function creerRepriseDesFils(deps: DependancesDeLaReprise): {
  replanifier: () => void
  etatDuFil: (fil: FilLu) => EtatDeRepriseDuFil | undefined
} {
  let runsLus: { a: number; fils: ReadonlySet<string> } | undefined
  const runsEnMemoire = (): ReadonlySet<string> => {
    const instant = Date.now()
    if (!runsLus || instant - runsLus.a >= MEMOIRE_DES_RUNS_MS)
      runsLus = { a: instant, fils: deps.filsAvecRunAReprendre() }
    return runsLus.fils
  }

  const etatDuFil = (fil: FilLu): EtatDeRepriseDuFil | undefined =>
    etatDeRepriseDuFil({
      fil,
      maintenant: Date.now(),
      planDeLots: () => deps.filDansUnPlan(fil.id),
      runAReprendre: () => runsEnMemoire().has(fil.id)
    })

  /**
   * Ce fil repartirait-il si son plan, son run et sa mise à l'écart se levaient ? Ces trois-là changent
   * sans fin de tour. Pas de disque ici : un vieux fil coupé ne doit pas relire les runs à vie.
   */
  const peutEncoreRepartir = (fil: FilLu): boolean =>
    etatDeRepriseDuFil({
      fil: { ...fil, inactive: false },
      maintenant: Date.now(),
      planDeLots: () => false,
      runAReprendre: () => false
    })?.etat === 'attente'

  // Le réveil est écrit pour les runs : ici, son `runId` est l'identifiant du fil.
  const filsAReprendre = (): RunSuspenduParQuota[] =>
    deps.lireFils().flatMap((fil) => {
      const etat = etatDuFil(fil)
      if (etat?.etat !== 'attente') return []
      return [
        {
          runId: fil.id,
          quotaWall: {
            // L'heure de la coupure, pas du dernier message : une consigne ne fait pas un nouveau mur.
            decidedAt: tourDuFil(fil.messages)?.ts ?? 0,
            resumeAfter: etat.reprendA - MARGE_APRES_RETOUR_MS
          }
        }
      ]
    })

  const reveil = creerReveilApresQuota<RunSuspenduParQuota>({
    // 0 : le démarrage ne trie pas les fils. Un mur échu app fermée est donc repris ici, et non perdu.
    demarrageMs: 0,
    listerRunsReprenables: filsAReprendre,
    publicationDejaProuvee: () => false,
    // Relu DANS la file, et le disque aussi : un tour commencé ou un run apparu annulent le départ.
    actionDeReprise: ({ runId }) => {
      if (deps.filOccupe(runId)) return 'ignorer'
      runsLus = undefined
      return runsEnMemoire().has(runId) ? 'ignorer' : 'relancer'
    },
    mettreEnFile: deps.mettreEnFile,
    relancer: async ({ runId }) => {
      const fil = deps.lireFil(runId)
      if (!fil) return
      const issue = await deps.lancerTour(runId, [
        ...fil.messages.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: composerMessageDeReprise() }
      ])
      if (!issue.ok) deps.journal?.(`${runId} -> tour de reprise en échec : ${issue.error ?? ''}`)
    },
    surveillerEncore: () => deps.lireFils().some(peutEncoreRepartir),
    ...(deps.journal ? { journal: deps.journal } : {})
  })

  return { replanifier: reveil.replanifier, etatDuFil }
}
