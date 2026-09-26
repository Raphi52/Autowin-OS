import type { RunEntry } from './chat-view-types'
import type { OrchStep } from './chat-view-model'

/** Forme du run déplié, telle que le panneau la tient (`OpenRunState`). */
export type RunDeplie = {
  path: string
  content: string
  pending?: boolean
  error?: string
  mtime?: number
}

/**
 * LE RUN.md DÉPLIÉ SUIT SON RUN, SANS BOUTON (demande du 2026-09-26).
 *
 * Le détail d'un run (onglet Runs du panneau Détails) était lu UNE fois, au clic. Pendant que le
 * run avançait, la carte au-dessus se mettait à jour (statut, DoD) mais le contenu déplié restait
 * figé sur l'état du clic : il fallait replier puis redéplier pour le voir bouger.
 *
 * Le signal existe déjà, sans nouvel événement : chaque entrée de la liste porte la date de
 * modification RÉELLE de son RUN.md (`mtime`, lue par `stat` côté main). Le main réécrit ce fichier
 * juste avant d'annoncer chaque étape terminée (`populateConvRunSections` puis `orchestrate-step`),
 * et la liste est relue à ces battements. Il suffit donc de comparer la date vue au chargement du
 * détail à celle de la liste courante.
 *
 * Rend l'entrée à relire, ou `null` s'il n'y a rien à faire :
 * - aucun run déplié, ou son ouverture est encore en cours (`pending`) ;
 * - date de chargement inconnue — on ne relit pas à l'aveugle ;
 * - le run n'est plus dans la liste (supprimé, conversation changée) ;
 * - le fichier n'a pas bougé depuis le chargement.
 */
export function runOuvertARelire(
  openRun: { path: string; pending?: boolean; mtime?: number } | null,
  runs: readonly RunEntry[]
): RunEntry | null {
  if (!openRun || openRun.pending || openRun.mtime === undefined) return null
  const entree = runs.find((run) => run.path === openRun.path)
  if (!entree) return null
  return entree.mtime !== openRun.mtime ? entree : null
}

/** Les deux lectures disque dont la relecture a besoin (sous-ensemble de `window.api`). */
export type LecteurRun = {
  runTrace: (path: string) => Promise<unknown>
  readNodeFile: (path: string) => Promise<{ path: string; content: string }>
}

/**
 * Ce qu'une relecture a rapporté.
 * - `trace` : le fil des sous-agents à afficher (celui déjà affiché si sa lecture a échoué) ;
 * - `contenu` : le nouveau RUN.md, ABSENT si sa lecture a échoué (on garde alors l'ancien) ;
 * - `montrerRunMd` : vrai quand un fil apparaît alors que le RUN.md était affiché faute de fil.
 *   Sans ce forçage, l'onglet par défaut (« Fil des sous-agents ») prendrait la place du RUN.md
 *   sous les yeux de l'utilisateur, alors qu'il n'a rien cliqué.
 */
export type Relecture = { trace: OrchStep[] | null; contenu?: string; montrerRunMd: boolean }

/**
 * Relit le fil et le RUN.md d'un run déplié, SANS jamais lever : un fichier en pleine écriture
 * peut refuser la lecture, et l'affichage courant doit alors rester tel quel.
 */
export async function relireRun(
  lecteur: LecteurRun,
  run: RunEntry,
  filAffiche: OrchStep[] | null,
  signalerEchec: (portee: string, erreur: unknown) => void
): Promise<Relecture> {
  let trace: OrchStep[] | null
  try {
    const lue = (await lecteur.runTrace(run.path)) as OrchStep[] | null
    trace = Array.isArray(lue) && lue.length > 0 ? lue : null
  } catch (erreur) {
    signalerEchec('run-trace', erreur)
    trace = filAffiche
  }
  let contenu: string | undefined
  try {
    contenu = (await lecteur.readNodeFile(run.path)).content
  } catch (erreur) {
    signalerEchec('run-md-relecture', erreur)
  }
  return {
    trace,
    ...(contenu === undefined ? {} : { contenu }),
    montrerRunMd: !filAffiche && trace !== null
  }
}

/**
 * Nouvel état du run déplié après une relecture.
 *
 * Replié ou remplacé par un autre run pendant la lecture → inchangé : le résultat est jeté.
 * Lecture du RUN.md échouée → contenu affiché gardé, mais la date est retenue quand même, sinon le
 * panneau redemanderait la même version en boucle ; la version suivante réessaiera.
 */
export function fusionnerRelecture(
  courant: RunDeplie | null,
  run: RunEntry,
  contenu: string | undefined
): RunDeplie | null {
  if (courant?.path !== run.path) return courant
  if (contenu === undefined) return { ...courant, mtime: run.mtime }
  return { path: courant.path, content: contenu, mtime: run.mtime }
}
