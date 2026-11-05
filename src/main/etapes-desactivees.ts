import { nativeSkills } from './native-registry'
import { resolveSkillAlias } from '../shared/skill-aliases'
import type { EdgeCondition, WorkflowEdge, WorkflowGraph } from './workflow-graph'

/**
 * UNE SKILL D'ÉTAPE DÉSACTIVÉE NE SE JOUE PLUS (choix de l'utilisateur, conv-1602, 2026-11-05).
 *
 * L'interrupteur « activé » de Settings › Skills n'avait plus aucun effet sur les étapes : l'ancien
 * lecteur (`phaseInstruction`, skill-pipeline.ts) ne retirait que le TEXTE de la skill, et n'avait
 * plus d'appelant depuis le 09/08 ; il a été retiré le 05/11 (conv-1613). Une étape désactivée se
 * jouait donc quand même, dans un run comme par « /nom » dans le fil. Seul `skill_charger` refusait.
 *
 * Désactivée veut dire, pour une étape comme pour toute skill : ni injectée, ni jouée. Une exception :
 * le juge reste joué DANS un run, parce que c'est lui qui contrôle son résultat à la fin ; un
 * « /judge » lancé seul est en revanche refusé comme toute étape nommée.
 */
export type EtapeDesactivee = (phase: string) => boolean

const JUGE = 'judge'

/**
 * Lecture réelle du réglage. Une étape sans dossier de skill (aucun interrupteur) reste active.
 *
 * Une lecture qui échoue rend « active » : c'est le défaut du registre lui-même (`nativeSkills`,
 * « actif par défaut ; seul un false explicite désactive »). Un réglage illisible ne doit pas
 * couper toutes les étapes d'un run.
 */
export function etapeDesactiveeDansLesReglages(phase: string): boolean {
  try {
    return nativeSkills().some((skill) => skill.id === phase && !skill.enabled)
  } catch {
    return false
  }
}

/** Une étape désactivée que le run peut SAUTER — jamais le juge, qui contrôle la fin du run. */
function sautable(phase: string, desactivee: EtapeDesactivee): boolean {
  return phase !== JUGE && desactivee(phase)
}

/** Les étapes à jouer, privées de celles que l'utilisateur a désactivées (le juge reste). */
export function sansEtapesDesactivees<T extends string>(
  phases: readonly T[],
  desactivee: EtapeDesactivee
): T[] {
  return phases.filter((phase) => !sautable(phase, desactivee))
}

/** L'arête qui enjambe une étape retirée : A→X (si `avant`) puis X→Y (si `apres`), ou rien. */
function conditionEnjambee(avant: EdgeCondition, apres: EdgeCondition): EdgeCondition | undefined {
  if (avant === 'always') return apres
  if (apres === 'always' || apres === avant) return avant
  return undefined
}

/**
 * Le graphe d'un workflow, privé des étapes désactivées.
 *
 * Une étape sautée ne produit rien : le verdict qui y ENTRE est celui qui en SORT. Chaque arête
 * A→X est donc remplacée par A→Y pour chaque sortie X→Y compatible avec sa condition (`always`
 * laisse passer l'autre condition ; `green` puis `red` ne se suivent pas). Le budget d'un retour
 * vient de l'arête X→Y quand elle en porte un, sinon de A→X. L'entrée sautée cède la place à la
 * suite verte ou inconditionnelle, comme le marcheur au départ (verdict vert par défaut).
 * Un graphe sans étape désactivée est rendu TEL QUEL (même objet).
 */
export function grapheSansEtapesDesactivees(
  graphe: WorkflowGraph,
  desactivee: EtapeDesactivee
): WorkflowGraph {
  let courant = graphe
  // Une étape retirée par tour : les chaînes (X puis Z désactivés) se résolvent pas à pas, et le
  // nombre de tours est borné par le nombre de nœuds.
  for (let tour = 0; tour < graphe.nodes.length; tour++) {
    const retire = courant.nodes.find((node) => sautable(node.phase, desactivee))
    if (!retire) return courant
    const id = retire.id
    const entrantes = courant.edges.filter((e) => e.to === id && e.from !== id)
    const sortantes = courant.edges.filter((e) => e.from === id && e.to !== id)
    const enjambees: WorkflowEdge[] = []
    for (const a of entrantes) {
      for (const b of sortantes) {
        const when = conditionEnjambee(a.when, b.when)
        if (!when || a.from === b.to) continue
        const budget = b.maxTraversals ?? a.maxTraversals
        const arete: WorkflowEdge = { from: a.from, to: b.to, when }
        if (budget !== undefined) arete.maxTraversals = budget
        const doublon = enjambees.some(
          (e) => e.from === arete.from && e.to === arete.to && e.when === arete.when
        )
        if (!doublon) enjambees.push(arete)
      }
    }
    const gardees = courant.edges.filter((e) => e.from !== id && e.to !== id)
    const deja = (e: WorkflowEdge): boolean =>
      gardees.some((g) => g.from === e.from && g.to === e.to && g.when === e.when)
    const entree =
      courant.entry === id ? (sortantes.find((e) => e.when !== 'red')?.to ?? '') : courant.entry
    courant = {
      entry: entree,
      nodes: courant.nodes.filter((node) => node.id !== id),
      edges: [...gardees, ...enjambees.filter((e) => !deja(e))]
    }
  }
  return courant
}

/**
 * La note injectée à la place d'une skill désactivée tapée en « /nom » dans le fil, ou rien.
 *
 * Même format que `noteSkillInconnue` (skill-pipeline.ts) : l'utilisateur doit savoir que sa
 * commande n'a pas pris, sinon il croit que la skill a tourné.
 */
export function noteSkillDesactivee(
  id: string,
  skills: () => ReadonlyArray<{ id: string; enabled: boolean }> = nativeSkills
): string | undefined {
  const cible = resolveSkillAlias(id).toLowerCase()
  let etat: { id: string; enabled: boolean } | undefined
  try {
    etat = skills().find((skill) => skill.id.toLowerCase() === cible)
  } catch {
    return undefined // registre illisible : même défaut que le registre, la skill reste active
  }
  if (!etat || etat.enabled) return undefined
  return (
    `\n=== SKILL DÉSACTIVÉE ===\n` +
    `L'utilisateur a tapé « /${etat.id} », mais cette skill est désactivée dans Settings › Skills : ` +
    `sa procédure n'est pas chargée. Ne la joue pas, et ne lance aucune étape « ${etat.id} » par ` +
    `orchestrate : un run la refuserait. Dis-lui en une ligne qu'elle est désactivée et où la ` +
    `réactiver, puis traite le reste de son message sans elle.\n`
  )
}

/**
 * Le refus de DÉPART d'un run, avant tout appel au modèle, ou rien.
 *
 * Deux cas seulement, parce que sauter l'étape y serait pire que refuser :
 * - l'étape NOMMÉE par la demande (`/build …`, `/judge …`) : la sauter laisserait un run vide ;
 * - un run qui doit MODIFIER des fichiers sans l'étape build : seule elle modifie, et la boucle de
 *   réparation la rejouerait de toute façon après le refus du contrôle final (la boucle du lot 4,
 *   220 refus, conv-1613).
 * Ailleurs, une étape désactivée est simplement sautée.
 */
export function refusEtapeDesactivee(entree: {
  phaseNommee?: string
  modifie: boolean
  desactivee: EtapeDesactivee
}): string | undefined {
  const { phaseNommee, modifie, desactivee } = entree
  if (phaseNommee && desactivee(phaseNommee)) {
    return `L’étape « ${phaseNommee} » est désactivée dans Settings › Skills : ce run ne la joue pas. Réactive-la pour la lancer.`
  }
  if (modifie && desactivee('build')) {
    return 'L’étape « build » est désactivée dans Settings › Skills : ce run doit modifier des fichiers, et seule cette étape le fait. Réactive-la pour le lancer.'
  }
  return undefined
}
