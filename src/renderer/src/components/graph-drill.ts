import type { RadialBand } from './graph-radial-layout'

/**
 * FORAGE dans le disque radial : couronnes → membres d'une couronne → catégories d'un dépôt.
 *
 * Pourquoi un module séparé de `graph-radial-layout.ts` : ce dernier porte des invariants de
 * LISIBILITÉ durement acquis (aucune fiche perdue, espacement minimal, pas de recouvrement) gardés
 * par ses propres tests. Le forage est une autre question — « où le clic tombe-t-il, et que
 * montre-t-on ensuite » — et n'a aucune raison de fragiliser ces invariants.
 *
 * Tout est PUR ici : aucun DOM, aucun three.js. La détection de clic sur une couronne n'exige pas de
 * raycaster, contrairement à ce que j'avais estimé : les bandes étant concentriques, un clic se
 * résout en géométrie — rayon du point cliqué, puis la bande qui le contient.
 *
 * VOCABULAIRE : on dit « dépôt » (repo), pas « projet ». Décidé avec l'utilisateur — « projet » était
 * ambigu entre trois mailles incompatibles (1003 `.csproj`, 24 dossiers `Source/`, 9 snapshots du
 * Brain), et la couronne comptait des NOTES en les faisant passer pour des projets.
 */

/* ─────────────────────────────── clic → couronne ─────────────────────────────── */

/**
 * La bande sous un clic, à partir de sa distance au centre.
 *
 * Renvoie `undefined` hors de toute bande — un clic dans le vide central ou au-delà du dernier
 * anneau ne doit RIEN sélectionner, sinon le geste « désélectionner en cliquant le fond » que la vue
 * offre déjà serait volé.
 */
export function bandAtRadius(bands: readonly RadialBand[], radius: number): RadialBand | undefined {
  if (!Number.isFinite(radius) || radius < 0) return undefined
  // Les bandes ne se recouvrent pas (invariant garanti par le layout) : la première qui contient le
  // rayon est la bonne. Bornes INCLUSIVES : un clic pile sur le trait doit atteindre sa bande.
  return bands.find((band) => radius >= band.innerRadius && radius <= band.outerRadius)
}

/** Distance au centre d'un point du plan du disque. */
export function radiusOf(x: number, y: number): number {
  return Math.hypot(x, y)
}

/* ─────────────────────────────── catégories d'un dépôt ─────────────────────────────── */

/**
 * Les catégories d'un dépôt. Ce ne sont PAS des cases inventées : chacune est adossée à une mesure
 * sur les 100 notes réelles du Brain.
 *
 * - `decisions` / `lessons` — le POURQUOI. Mesuré : 5 notes `type: decision` dans tout le Brain,
 *   **zéro par projet**, et 21 leçons. Ces deux catégories sont donc VIDES au départ, et c'est
 *   précisément l'information utile : un compteur honnête à zéro pousse à le remplir, une catégorie
 *   masquée ne dit rien. C'est aussi la seule connaissance qu'aucun `ripgrep` ne retrouvera.
 * - `areas` (52 notes) et `relations` (38) — l'INDEX du code. Utile, mais `ripgrep` fait déjà mieux
 *   pour localiser (A/B mesuré sur RIG : 2-3× plus rapide, aussi juste).
 * - `map` (8) — la carte du dépôt.
 * - `other` — tout ce qui ne se classe pas. Existe pour que RIEN ne disparaisse du décompte.
 */
export type RepoCategory = 'decisions' | 'lessons' | 'areas' | 'relations' | 'map' | 'other'

/** Ordre d'affichage : le POURQUOI d'abord, l'index ensuite. Ce n'est pas cosmétique. */
export const REPO_CATEGORY_ORDER: readonly RepoCategory[] = [
  'decisions',
  'lessons',
  'areas',
  'relations',
  'map',
  'other'
]

export const REPO_CATEGORY_LABELS: Readonly<Record<RepoCategory, string>> = {
  decisions: 'Décisions',
  lessons: 'Leçons',
  areas: 'Zones de code',
  relations: 'Relations',
  map: 'Carte du dépôt',
  other: 'Divers'
}

/**
 * Classe une note d'après son chemin relatif au vault.
 *
 * Le chemin est l'axe RÉEL : mesuré sur les 100 notes de projets, le frontmatter est plat
 * (98 fois `type: domain`, `kind: map`, `status: active`) et ne discrimine RIEN. Les tags le
 * confirment sans le contredire : `area` (52), `relation` (38), `project` (8) — c'est la même
 * partition, donc s'appuyer sur le chemin ne contredit pas la règle 8 du schéma de note.
 */
export function categoryOfNote(relativeId: string): RepoCategory {
  const path = relativeId.replace(/\\/g, '/').toLowerCase()
  if (/(^|\/)decisions?\//.test(path)) return 'decisions'
  if (/(^|\/)(lessons?|lecons?|le[cç]ons?)\//.test(path)) return 'lessons'
  if (/(^|\/)areas?\//.test(path)) return 'areas'
  if (/(^|\/)relations?\//.test(path)) return 'relations'
  // La note racine d'un dépôt porte son nom : `projects/<repo>/obsidian/<repo>.md`.
  const segments = path.split('/').filter(Boolean)
  const last = segments.at(-1)?.replace(/\.md$/, '')
  if (last && segments.includes(last) && segments.length >= 2) return 'map'
  return 'other'
}

export interface RepoCategoryCount {
  category: RepoCategory
  label: string
  count: number
}

export interface RepoSummary {
  repo: string
  total: number
  categories: readonly RepoCategoryCount[]
  /**
   * Vrai quand le dépôt n'a AUCUNE note classable — le cas réel d'`autowin-os`, qui n'a que son
   * snapshot de code. La vue doit le DIRE, pas afficher un écran vide.
   */
  empty: boolean
}

/**
 * Résume un dépôt en catégories. Deux garanties, et elles sont testées :
 *  - **partition** — la somme des comptes égale le nombre de notes : aucune note perdue, aucune
 *    comptée deux fois ;
 *  - **zéros VISIBLES** — `decisions` et `lessons` apparaissent même à zéro, parce que leur absence
 *    est l'information la plus utile de cette vue.
 */
export function summarizeRepo(repo: string, relativeIds: readonly string[]): RepoSummary {
  const counts = new Map<RepoCategory, number>()
  for (const category of REPO_CATEGORY_ORDER) counts.set(category, 0)
  for (const id of relativeIds) {
    const category = categoryOfNote(id)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const categories = REPO_CATEGORY_ORDER.filter(
    // On garde toujours le POURQUOI, même vide ; on masque seulement les catégories d'index vides,
    // qui n'apprennent rien par leur absence.
    (category) =>
      category === 'decisions' || category === 'lessons' || (counts.get(category) ?? 0) > 0
  ).map((category) => ({
    category,
    label: REPO_CATEGORY_LABELS[category],
    count: counts.get(category) ?? 0
  }))
  return { repo, total: relativeIds.length, categories, empty: relativeIds.length === 0 }
}

/* ─────────────────────────────── étiquettes de couronne ─────────────────────────────── */

/**
 * Écarte les étiquettes de couronne pour qu'elles ne se recouvrent plus.
 *
 * Le défaut est VISIBLE sur la capture d'origine de l'utilisateur : les six libellés (`INBOX`,
 * `INTEGRATIONS`, `PROJECTS`, `KNOWLEDGE`, `GOVERNANCE`, `RACINE`) se touchent en haut au centre,
 * parce qu'ils sont tous posés sur l'axe vertical à la mi-hauteur de leur bande — et deux bandes
 * voisines peuvent être plus rapprochées que la hauteur d'un libellé.
 *
 * On PRÉSERVE la décision d'origine (toutes les étiquettes sur le même axe, donc lisibles comme une
 * légende plutôt que dispersées au hasard des points) et on corrige seulement le chevauchement : les
 * étiquettes trop proches sont poussées vers l'extérieur, dans l'ordre, d'un écart minimal. Aucune ne
 * descend jamais en dessous de sa position d'origine, sinon une étiquette sortirait de sa bande.
 */
export function spreadLabelRadii(radii: readonly number[], minGap: number): number[] {
  const sorted = [...radii].sort((a, b) => a - b)
  const out: number[] = []
  for (const radius of sorted) {
    const previous = out[out.length - 1]
    out.push(previous === undefined ? radius : Math.max(radius, previous + minGap))
  }
  // Rendu dans l'ordre des rayons FOURNIS, pour que l'appelant retrouve ses bandes.
  return radii.map((radius) => {
    const index = sorted.indexOf(radius)
    return out[index]
  })
}

/* ─────────────────────────────── dépôt ↔ projets du Brain ─────────────────────────────── */

/**
 * Le nom d'un dépôt, réduit à la forme que le Brain emploie pour ses dossiers.
 * `Autowin OS` → `autowin-os`, `RIG-TV` → `rig-tv`, `Fiche_Nouveau_Collaborateur` →
 * `fiche-nouveau-collaborateur`.
 */
export function repoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Les projets du Brain qui alimentent un dépôt.
 *
 * Le rattachement exact — même nom réduit — est SÛR. Le reste est une HEURISTIQUE assumée et
 * signalée : les 8 projets `rig-*` du Brain (`rig-etapefacture`, `rig-processus`…) sont des MODULES
 * de `RigApplication`, pas des dépôts distincts ; sans cette règle ils resteraient orphelins alors
 * que l'utilisateur a dit « tout ce qui est dans le repo RigApplication est un projet qui aura son
 * arborescence interne ». Toute correspondance heuristique est marquée, pour que la vue puisse le
 * DIRE plutôt que de laisser croire à un rattachement certain.
 */
export interface RepoBrainLink {
  project: string
  /** `exact` = même nom réduit. `heuristique` = module déduit d'un préfixe, à confirmer. */
  match: 'exact' | 'heuristique'
}

export function brainProjectsForRepo(
  repoName: string,
  projects: readonly string[],
  allRepoNames: readonly string[] = [repoName]
): RepoBrainLink[] {
  const slug = repoSlug(repoName)
  const exact = projects.filter((project) => repoSlug(project) === slug)
  if (exact.length > 0) return exact.map((project) => ({ project, match: 'exact' as const }))
  // Seul le monorepo hérite des modules `rig-*` restants — et seulement ceux qu'AUCUN autre dépôt
  // ne réclame par son nom, sinon `rig-tv` serait compté deux fois.
  if (slug !== 'rigapplication') return []
  const reclamesAilleurs = new Set(
    allRepoNames.filter((name) => repoSlug(name) !== slug).map((name) => repoSlug(name))
  )
  return projects
    .filter((project) => project.startsWith('rig-') && !reclamesAilleurs.has(repoSlug(project)))
    .map((project) => ({ project, match: 'heuristique' as const }))
}

/* ─────────────────────────────── état de navigation ─────────────────────────────── */

/**
 * Où l'on se trouve dans le forage. Une union discriminée plutôt qu'un `depth: number` + champs
 * optionnels : ici le compilateur refuse un état incohérent (une catégorie sans son dépôt), au lieu
 * de laisser l'incohérence se découvrir au rendu.
 */
export type DrillPosition =
  | { level: 'crowns' }
  | { level: 'crown'; family: string }
  | { level: 'repo'; family: string; repo: string }
  | { level: 'category'; family: string; repo: string; category: RepoCategory }

export const DRILL_ROOT: DrillPosition = { level: 'crowns' }

/** Descend d'un cran. Renvoie la position INCHANGÉE quand il n'y a rien de plus profond. */
export function drillInto(
  position: DrillPosition,
  target: { family?: string; repo?: string; category?: RepoCategory }
): DrillPosition {
  switch (position.level) {
    case 'crowns':
      return target.family ? { level: 'crown', family: target.family } : position
    case 'crown':
      return target.repo ? { level: 'repo', family: position.family, repo: target.repo } : position
    case 'repo':
      return target.category
        ? {
            level: 'category',
            family: position.family,
            repo: position.repo,
            category: target.category
          }
        : position
    case 'category':
      // Dernier niveau : on ne descend plus. Les items eux-mêmes sont des nœuds cliquables, et le
      // clic sur un nœud est déjà géré par la vue (sélection + voisinage).
      return position
  }
}

/** Remonte d'un cran. Depuis la racine, reste à la racine — jamais d'état invalide. */
export function drillBack(position: DrillPosition): DrillPosition {
  switch (position.level) {
    case 'crowns':
      return position
    case 'crown':
      return DRILL_ROOT
    case 'repo':
      return { level: 'crown', family: position.family }
    case 'category':
      return { level: 'repo', family: position.family, repo: position.repo }
  }
}

/**
 * Le fil d'Ariane, du plus général au plus précis. C'est ce qui rend un forage utilisable plutôt
 * qu'infernal : sans chemin de retour visible, on se perd dès le deuxième niveau.
 */
export function drillTrail(position: DrillPosition): readonly string[] {
  const trail = ['Tout']
  if (position.level === 'crowns') return trail
  trail.push(position.family)
  if (position.level === 'crown') return trail
  trail.push(position.repo)
  if (position.level === 'repo') return trail
  trail.push(REPO_CATEGORY_LABELS[position.category])
  return trail
}
