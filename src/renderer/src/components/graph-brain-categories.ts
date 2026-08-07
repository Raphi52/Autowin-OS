import { pathSegments, relativePathOf } from './graph-radial-layout'
import type { GraphNode } from './graph-view-model'

/**
 * CATÉGORIES COGNITIVES — le premier anneau de l'arbre, par analogie avec un cerveau : ce qu'on sait
 * faire, ce dont on se souvient, où l'on est, et ce qu'on sait.
 *
 * POURQUOI « Environnement ET CONTRAINTES » et non « Environnement » tout court : mesuré. Un
 * sous-agent à qui l'on demandait « pourquoi une transaction échoue-t-elle en silence ? » a routé la
 * question vers `Savoir`, pas vers `Environnement`. Il lisait la catégorie comme « où vivent les
 * choses », alors que la moitié de son sens est « ce que le terrain exige ou interdit » — donc aussi
 * les pannes qu'il provoque. Le nom ne portait pas cette moitié ; il la porte maintenant.
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

export type BrainCategory =
  | 'Comportement'
  | 'Mémoires'
  | 'Environnement et contraintes'
  | 'Savoir'
  | 'Documentation'
  | 'Code'
  | 'À trier'
  | 'Non classé'

/** L'ordre d'affichage, et rien d'autre : la précédence de rattachement est celle des règles. */
export const BRAIN_CATEGORIES: readonly BrainCategory[] = [
  'Comportement',
  'Mémoires',
  'Environnement et contraintes',
  'Savoir',
  'Documentation',
  'Code',
  'À trier',
  'Non classé'
]

/** Fichiers de consigne à la racine du vault : des règles de conduite, pas des inclassables. */
const RACINE_CONDUITE = new Set(['claude.md', 'agents.md', 'readme.md', 'home.md', 'index.md'])

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
  if (has(themes, 'environnement', 'environment', 'theme/environnement'))
    return 'Environnement et contraintes'
  // Les connecteurs vers des systèmes tiers SONT de l'environnement : ce qu'on doit joindre, et à
  // quelles conditions.
  if (segments[0] === 'integrations') return 'Environnement et contraintes'

  // 2. Comment on travaille — les règles de conduite.
  if (has(themes, 'kit', 'process', 'preference')) return 'Comportement'
  if (segments[0] === 'governance') return 'Comportement'
  if (segments[1] === 'preferences') return 'Comportement'
  // Les consignes de la racine du vault (`CLAUDE.md`, `AGENTS.md`) sont littéralement des règles de
  // conduite. Elles tombaient dans « Non classé », ce qui était faux deux fois : ni non classables,
  // ni sans catégorie évidente.
  if (segments.length === 1 && RACINE_CONDUITE.has(segments[0])) return 'Comportement'

  // 3. Ce dont on se souvient — ce qui s'est passé, ce qu'on a choisi.
  if (has(themes, 'decision-tracee', 'lesson')) return 'Mémoires'
  if (segments.includes('decisions') || segments.includes('lessons')) return 'Mémoires'

  // 4. LE FOURRE-TOUT ÉCLATÉ. Une seule règle envoyait tout `knowledge`/`projects` dans « Savoir »,
  //    qui pesait alors 484 fiches sur 628 — 77 % du vault. Mesuré, son contenu réel était : 345
  //    fiches d'un arbre de doc IMPORTÉ, 100 cartes de code GÉNÉRÉES, et seulement 38 notes de savoir
  //    réellement rédigées. « Savoir » était donc une étiquette mensongère : un défaut de repli
  //    déguisé en catégorie. Chacune de ces trois natures a désormais son nom.
  // Le rattachement passe par le CHEMIN, pas par les tags seuls. Mesuré dans l'app : la vue
  // affichait `Savoir · 137` = `knowledge · 38` + `projects · 99`, donc les 99 fiches de projets
  // n'atteignaient PAS `Code` — leurs tags n'arrivent pas jusqu'ici sous la forme attendue. Le
  // chemin, lui, est connu avec certitude.
  if (has(themes, 'code-map', 'area', 'relation', 'graphify')) return 'Code'
  // `projects/<dépôt>/obsidian/{areas,relations}/…` et la carte du dépôt sont des cartes de code.
  // L'exception `decisions` est essentielle : les 30 décisions moissonnées vivent sous ce même
  // préfixe, et les verser dans `Code` serait la mauvaise attribution que tout ceci veut éviter.
  if (segments[0] === 'projects' && !segments.includes('decisions')) return 'Code'
  if (segments.includes('rigapplication-documentation')) return 'Documentation'
  if (segments[0] === 'knowledge' || segments[0] === 'projects') return 'Savoir'

  // 5. Ce qui attend d'être trié — le tampon d'entrée, pas encore consolidé.
  if (segments[0] === 'inbox') return 'À trier'

  // 6. Le reste est NOMMÉ, pas dissous. Une fiche qu'aucune règle n'attrape doit se voir : c'est ce
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
