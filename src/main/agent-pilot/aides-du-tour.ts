// Petites aides du tour de chat (cap d'itérations, dernier message humain, capture annulable,
// attente d'une réponse, identité du fil, descriptions des commandes), sorties telles quelles de
// agent-pilot.ts (lot 1).
import type { Message } from '../providers/types'
import { captureMutationTraceBase } from '../activity/trace-workspace-mutation'
import { nativeSkills } from '../app/native-registry'

/**
 * CAP D'ITÉRATIONS d'un tour de chat — UNE seule valeur par défaut, exportée.
 *
 * Relevé de 6 à 12 le 2026-07-29 : sur un blocage réel, l'agent consommait 4 itérations en
 * `edit_file` ratés avant même de pouvoir chercher une autre voie, puis s'arrêtait sur « cap atteint
 * sans réponse finale » en laissant des mutations partielles.
 *
 * Cette constante existe parce que le relèvement N'ATTEIGNAIT PAS l'application : le chat interactif
 * repliait sur un `?? 6` codé en dur (`index.ts`), et comme aucune police n'est fournie quand un
 * humain tape dans le composer, la production tournait à 6 pendant que la signature affichait 12.
 * Mesuré le 2026-08-19 en pilotant l'app : un scout a rendu « Cap d'itérations (6) atteint » et
 * aucun livrable. Deux valeurs par défaut concurrentes pour un même fait — le commentaire qui
 * justifiait 12 décrivait un monde qui n'existait pas.
 */
/*
 * RELEVÉ DE 12 À 40 le 2026-09-03 : demande utilisateur mesurée. La boucle réelle d'une
 * correction pilotée depuis le chat (chercher la règle → lire le fichier → éditer → naviguer →
 * observer → lire la capture → revenir) dépense à elle seule une dizaine d'appels ; à 12, le tour se
 * coupait AVANT la phrase de clôture et l'app affichait « Réponse interrompue avant la fin ».
 *
 * SUPPRIMÉ le 2026-09-04, demande explicite de l'utilisateur (« ENLEVE CE PUTAIN DE
 * BLOQUAGE DE BUDGET ») : relever la borne ne faisait que déplacer la coupure. Ce compteur coupait
 * des tours ENGAGÉS alors qu'il ne mesure RIEN du coût réel — un tour de 41 appels bon marché était
 * tué, un tour de 5 appels ruineux passait. Le seul frein qui reste est l'annulation manuelle : le
 * budget du tour de chat a lui aussi été supprimé le 2026-09-16, sur demande de l'utilisateur
 * (« aucun blocage ») ; le coût est désormais MESURÉ et écrit, jamais coupé.
 * Avec l'infini, les injections « budget du tour » et « dernière itération » ne se déclenchent plus :
 * leurs conditions comparent l'index à une borne finie.
 */
export const CAP_ITERATIONS_TOUR = Number.POSITIVE_INFINITY

export function resolveLatestUserMessage(
  history: Array<Pick<Message, 'role' | 'content'>>,
  routingUserMessageOverride?: string
): string | undefined {
  return (
    routingUserMessageOverride ??
    [...history].reverse().find((message) => message.role === 'user')?.content
  )
}

/** Sous le dossier du tour, mais hors du projet : scripts jetables et données de l'app. */
const DOSSIERS_HORS_PROJET: ReadonlySet<string> = new Set(['.autowin-tmp', '.autowin-data'])

/**
 * Les fichiers DU PROJET parmi ceux qu'un appel a écrits, une fois chacun, en chemins à barres
 * obliques. Une sonde jetable sous `.autowin-tmp` n'est pas un changement à faire vérifier : sans
 * ce tri, un tour d'analyse qui s'aide d'un script resterait « à vérifier » sur le Board.
 */
export function fichiersEcritsDuProjet(chemins: Iterable<string>): string[] {
  const vus = new Set<string>()
  const ecrits: string[] = []
  for (const brut of chemins) {
    const chemin = brut.trim().replaceAll('\\', '/')
    const cle = chemin.toLowerCase()
    if (!chemin || vus.has(cle)) continue
    if (cle.split('/').some((dossier) => DOSSIERS_HORS_PROJET.has(dossier))) continue
    vus.add(cle)
    ecrits.push(chemin)
  }
  return ecrits
}

/**
 * Capture avant/apres du dossier du tour, ABANDONNEE des qu'on annule : elle coute ~200 ms de git
 * sur un gros depot, et un Stop ne doit jamais attendre l'observabilite. Rend `undefined` = pas de
 * trace pour ce tour, jamais une erreur.
 */
export async function captureSaufAnnulation(
  workspace: string,
  signal?: AbortSignal
): Promise<Awaited<ReturnType<typeof captureMutationTraceBase>>> {
  if (signal?.aborted) return undefined
  if (!signal) return captureMutationTraceBase(workspace, [])
  return new Promise((resolve) => {
    const abandon = (): void => resolve(undefined)
    signal.addEventListener('abort', abandon, { once: true })
    captureMutationTraceBase(workspace, [])
      .then(resolve, () => resolve(undefined))
      .finally(() => signal.removeEventListener('abort', abandon))
  })
}

export function waitForAnswer(answer: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return answer
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason ?? 'aborted')))
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error(String(signal.reason ?? 'aborted')))
    signal.addEventListener('abort', abort, { once: true })
    answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * L'identite du fil injectee au modele est celle du TOUR, jamais celle de l'onglet AFFICHE.
 * `snapshotForPrompt()` porte `activeConversationId`, pose par le renderer au changement d'onglet.
 * Un tour qui se joue dans conv-A pendant que l'utilisateur regarde conv-B faisait donc lire au
 * modele l'id de conv-B : il se croyait dans un autre fil, declarait son historique vide, et pouvait
 * partir chercher « le vrai fil » avec `conversation_search` — alors que l'historique, lui, etait
 * correctement transmis. Mesure : reponse « cet echange arrive dans un fil
 * different (conv-533)… ce fil-ci est vide » rendue.
 */
export function snapshotDuTour<T extends { activeConversationId?: string }>(
  snapshot: T,
  conversationId?: string
): T {
  return conversationId ? { ...snapshot, activeConversationId: conversationId } : snapshot
}

/**
 * La description (SKILL.md) des commandes citées, pour le contrôle des deux lectures. Même source
 * que la palette `/`. Une lecture du disque qui échoue rend `{}` : le contrôle lit alors sans elles.
 */
export function descriptionsDesCommandes(noms: readonly string[]): Record<string, string> {
  if (!noms.length) return {}
  try {
    const parNom = new Map(
      nativeSkills().map((skill) => [skill.id.toLowerCase(), skill.description])
    )
    return Object.fromEntries(
      noms.flatMap((nom) => {
        const description = parNom.get(nom)
        return description ? [[nom, description]] : []
      })
    )
  } catch {
    return {}
  }
}

/**
 * Motif d'une itération ACCORDÉE en plus du cap (`grantRecoveryIteration`, AgentPilot.chat()). Union
 * écrite deux fois dans chat() (lot 2) : une seule source désormais.
 */
export type MotifDeRallonge =
  | 'late-directive'
  | 'invalid-question'
  | 'muted-turn'
  | 'chiffre-non-verifie'
  | 'conclusion-absente'
  | 'echec-taise'
  | 'correction-apres-echec'
  | 'annonce-sans-action'
  | 'outil-pretendu-absent'
  | 'question-sans-lecture'
  | 'commande-illisible'
  | 'preuve-promise'
  | 'geste-rendu'
  | 'preuve-absente'
  | 'bloc-visuel-non-ferme'
  | 'chemin-incomplet'
