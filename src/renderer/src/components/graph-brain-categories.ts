import { pathSegments, relativePathOf } from './graph-radial-layout'
import type { GraphNode } from './graph-view-model'

/**
 * CATÉGORIES COGNITIVES — le premier anneau de l'arbre, par analogie avec un cerveau : ce qu'on sait
 * faire, ce dont on se souvient, où l'on est, et ce qu'on sait.
 *
 * C'est une couche de LECTURE, dérivée. Aucun fichier n'est déplacé dans le Brain : son outillage
 * (`brain_validate.py`, `obsidian_graph.py`, `rig_coverage.py`) est couplé aux chemins, le dépôt est
 * partagé, et un déménagement casserait tout le monde pour un gain d'affichage.
 *
 * ------------------------------------------------------------------------------------------------
 * CE QUI EST DÉRIVÉ, ET CE QUI NE L'EST PAS — mesuré sur les 628 fiches, pas supposé.
 *
 * Trois catégories se lisent dans les métadonnées déjà présentes (les tags du frontmatter arrivent
 * jusqu'ici : `noteThemes` les injecte dans `themes`).
 *
 * La quatrième, `environnement`, ne se dérive PAS. L'heuristique évidente — chercher
 * `serveur|SQL-PROD|partage|GAC|MSDTC|Dev Shell|droits|déploiement` dans le corps — a été essayée et
 * RÉFUTÉE par la mesure : elle attrape 281 fiches sur 628, soit 45 % du vault. Une catégorie qui
 * avale la moitié du Brain ne trie rien, et ses faux rattachements seraient invisibles.
 *
 * `environnement` est donc alimentée par un TAG EXPLICITE, posé sciemment sur une liste revue. Une
 * fiche non taguée n'y entre pas, et c'est voulu : mieux vaut une catégorie petite et juste qu'une
 * catégorie vaste et fausse.
 * ------------------------------------------------------------------------------------------------
 */

export type BrainCategory = 'Comportement' | 'Mémoires' | 'Environnement' | 'Savoir' | 'Non classé'

/** L'ordre d'affichage, et rien d'autre : la précédence de rattachement est celle des règles. */
export const BRAIN_CATEGORIES: readonly BrainCategory[] = [
  'Comportement',
  'Mémoires',
  'Environnement',
  'Savoir',
  'Non classé'
]

const has = (themes: readonly string[], ...cherches: string[]): boolean =>
  themes.some((theme) => cherches.includes(theme.toLowerCase()))

/**
 * Rattache une fiche à sa catégorie. Les règles sont ORDONNÉES : la première qui mord gagne.
 *
 * La précédence n'est pas arbitraire, et un cas la décide vraiment. **40 fiches sont à la fois
 * `type: decision` et taguées `kit`/`process`** : elles sont autant une mémoire (« ce qu'on a
 * choisi ») qu'une règle de conduite (« comment on travaille »). Le comportement l'emporte, parce
 * que c'est ainsi qu'on les cherchera — on veut savoir comment travailler, pas se rappeler quand on
 * l'a décidé.
 *
 * `environnement` passe AVANT tout le reste : c'est le seul tag posé délibérément, donc une fiche
 * ainsi marquée doit atterrir là où on l'a marquée, sans qu'une règle plus générale la détourne.
 */
export function brainCategoryOf(node: Pick<GraphNode, 'id' | 'file' | 'themes'>): BrainCategory {
  const themes = (node.themes ?? []).map((t) => t.toLowerCase())
  const chemin = relativePathOf(node).toLowerCase()
  const segments = pathSegments(chemin)

  // 1. Le tag explicite gagne toujours : il a été posé pour ça.
  if (has(themes, 'environnement', 'environment', 'theme/environnement')) return 'Environnement'

  // 2. Comment on travaille — les règles de conduite.
  if (has(themes, 'kit', 'process', 'preference')) return 'Comportement'
  if (segments[0] === 'governance') return 'Comportement'
  if (segments[1] === 'preferences') return 'Comportement'

  // 3. Ce dont on se souvient — ce qui s'est passé, ce qu'on a choisi.
  if (has(themes, 'decision-tracee', 'lesson')) return 'Mémoires'
  if (segments.includes('decisions') || segments.includes('lessons')) return 'Mémoires'

  // 4. Ce qu'on sait — le savoir sémantique et les cartes de code.
  if (has(themes, 'code-map', 'area', 'relation', 'graphify')) return 'Savoir'
  if (segments[0] === 'knowledge' || segments[0] === 'projects') return 'Savoir'

  // 5. Le reste est NOMMÉ, pas dissous. Une fiche qu'aucune règle n'attrape doit se voir : c'est ce
  //    compteur qui dira si les règles vieillissent mal.
  return 'Non classé'
}

/** Compte par catégorie, dans l'ordre d'affichage — y compris les catégories vides. */
export function countByBrainCategory(
  nodes: readonly Pick<GraphNode, 'id' | 'file' | 'themes'>[]
): Record<BrainCategory, number> {
  const out = Object.fromEntries(BRAIN_CATEGORIES.map((c) => [c, 0])) as Record<
    BrainCategory,
    number
  >
  for (const node of nodes) out[brainCategoryOf(node)] += 1
  return out
}
