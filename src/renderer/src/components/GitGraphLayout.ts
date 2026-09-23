import {
  selectGitGraphMainRef,
  type GitGraphCommit,
  type GitGraphElision,
  type GitGraphRef
} from '../../../shared/git-graph'
import { couleurDeBranche, couleurDeVoie } from './git-graph-couleurs'
import { brancheDeCommit } from './git-graph-refs'

/**
 * LA GÉOMÉTRIE DU TRACÉ — celle d'une COLONNE de tableau, façon SourceTree.
 *
 * Ces deux constantes sont un CONTRAT avec le rendu : chaque ligne du SVG doit tomber exactement sur
 * une ligne de texte. Elles sont exportées pour que la vue et le calcul ne puissent pas diverger —
 * un pas vertical recopié à la main des deux côtés finit toujours par décaler les points d'un cran,
 * et un point en face du mauvais commit est pire qu'un graphe absent.
 */
/**
 * 20 px, et non 26 : MESURÉ sur la capture SourceTree fournie le 2026-09-16, une ligne d'historique
 * y fait 19-20 px. À 26 px, le même écran montrait ~18 commits là où SourceTree en montre 25, et
 * l'espace vide entre les points cassait la lecture verticale d'une branche — le reproche exact de
 * l'utilisateur (« beaucoup plus clair chez SourceTree »). La densité EST la lisibilité ici : un
 * graphe de branches se lit par la continuité des colonnes, pas commit par commit.
 */
export const HAUTEUR_LIGNE = 20
/** 12 px, comme l'écart entre deux voies de SourceTree : plus large, les voies cessent de se lire
 * comme un faisceau et deviennent des traits isolés. */
export const LARGEUR_VOIE = 12
/** Marge à gauche et à droite de la gouttière : le rayon du point, plus un souffle. */
export const MARGE_VOIE = 10

export interface GitGraphLayoutNode {
  commit: GitGraphCommit
  lane: number
  x: number
  y: number
  side?: 'closed' | 'main' | 'open'
  /** Couleur de la voie, fonction PURE du nom de branche. Voir `git-graph-couleurs`. */
  couleur: string
  /** Nom de branche porté par ce commit, quand il en porte un. Sert l'étiquette ET la couleur. */
  branche?: string
}

export interface GitGraphLayoutEdge {
  from: GitGraphLayoutNode
  to: GitGraphLayoutNode
  lane: number
  /** La couleur de la VOIE que le trait emprunte : c'est elle qu'on suit des yeux. */
  couleur: string
  /** Arête qui ENJAMBE une histoire non chargée : à tracer autrement qu'une parenté réelle. */
  elidee?: boolean
  /** Nombre de commits omis par ce saut. Absent sur une arête réelle. */
  omis?: number
}

export interface GitGraphLayout {
  nodes: GitGraphLayoutNode[]
  edges: GitGraphLayoutEdge[]
  width: number
  height: number
}

export interface GitGraphLayoutAxes {
  main: ReadonlySet<string>
  ouvertes: ReadonlySet<string>
}

export interface GitGraphReachability {
  mainLineHashes?: readonly string[]
  mergedIntoMainHashes?: readonly string[]
  openBranchHashes?: readonly string[]
}

function commitsReachableFromRefs(
  commits: GitGraphCommit[],
  refs: GitGraphRef[]
): GitGraphCommit[] {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const included = new Set<string>()
  const pending = refs.map((ref) => ref.hash)
  while (pending.length > 0) {
    const hash = pending.pop()
    if (!hash || included.has(hash)) continue
    const commit = commitByHash.get(hash)
    if (!commit) continue
    included.add(hash)
    pending.push(...commit.parents)
  }
  return commits.filter((commit) => included.has(commit.hash))
}

export function projectGitGraphAxes(
  commits: GitGraphCommit[],
  refs: GitGraphRef[],
  reachability?: GitGraphReachability
): GitGraphLayoutAxes | undefined {
  const selectedMainRef = selectGitGraphMainRef(refs)
  const mainRef =
    selectedMainRef ??
    (reachability?.mainLineHashes?.[0]
      ? {
          name: 'HEAD',
          fullName: 'HEAD',
          kind: 'local' as const,
          hash: reachability.mainLineHashes[0],
          isHead: true
        }
      : undefined)
  if (!mainRef) return undefined

  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const fusionnesDansMain = new Set(
    reachability?.mergedIntoMainHashes ??
      commitsReachableFromRefs(commits, [mainRef]).map((commit) => commit.hash)
  )
  const main = new Set(reachability?.mainLineHashes ?? [])
  if (!reachability?.mainLineHashes) {
    let hash: string | undefined = mainRef.hash
    while (hash && !main.has(hash)) {
      const commit = commitByHash.get(hash)
      if (!commit) break
      main.add(hash)
      hash = commit.parents[0]
    }
  }

  return {
    main,
    ouvertes:
      reachability?.openBranchHashes !== undefined
        ? new Set(reachability.openBranchHashes)
        : new Set(
            commits
              .filter((commit) => !fusionnesDansMain.has(commit.hash))
              .map((commit) => commit.hash)
          )
  }
}

/**
 * Une voie retient un commit ATTENDU. Elle doit donc être rendue dès que cette attente n'a plus de
 * sens, sans quoi le tracé dérive vers la droite comme s'il y avait un second dépôt.
 *
 * MESURÉ sur ce dépôt (271 commits) : 38 voies occupées, largeur 2 952 px, alors que trois voies
 * simultanées suffisent. 35 de ces voies attendaient un commit DÉJÀ placé ailleurs, et 2 un commit
 * absent de la fenêtre de log. Rows 7 et 8 réservaient `c654ea2` que la voie 0 attendait déjà ; row 13
 * l'a placé en voie 0, et les voies 2 et 3 ont gardé ce hash pour toujours.
 *
 * Deux libérations, et rien de plus : pas de compactage, pas de renumérotation. Une voie qui garde sa
 * position garde la lisibilité verticale d'une branche.
 */
export function layoutGitGraph(
  commits: GitGraphCommit[],
  axes?: GitGraphLayoutAxes,
  elisions?: readonly GitGraphElision[]
): GitGraphLayout {
  const lanes: Array<string | undefined> = []
  const laneByHash = new Map<string, number>()
  const nodes: GitGraphLayoutNode[] = []
  // Ce qui n'est pas dans la fenêtre lue n'arrivera jamais : inutile de lui garder une voie.
  const presents = new Set(commits.map((commit) => commit.hash))
  const attendable = (hash: string | undefined): string | undefined =>
    hash !== undefined && presents.has(hash) ? hash : undefined

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = lanes.findIndex((value) => value === undefined)
      if (lane < 0) lane = lanes.length
    }
    // LIBÉRATION 1 : toute AUTRE voie qui attendait ce commit ne l'attendra jamais — il est ici.
    lanes.forEach((value, index) => {
      if (index !== lane && value === commit.hash) lanes[index] = undefined
    })
    const premierParent = attendable(commit.parents[0])
    // LIBÉRATION 2 : ne pas réserver DEUX voies pour le même parent. La voie existante le portera ;
    // dupliquer l'attente est exactement ce qui perdait 35 voies.
    const dejaAttendu =
      premierParent !== undefined &&
      lanes.some((value, index) => index !== lane && value === premierParent)
    lanes[lane] = dejaAttendu ? undefined : premierParent
    laneByHash.set(commit.hash, lane)
    commit.parents.slice(1).forEach((parent) => {
      if (!presents.has(parent) || lanes.includes(parent)) return
      const freeLane = lanes.findIndex((value, index) => index > lane && value === undefined)
      lanes[freeLane < 0 ? lanes.length : freeLane] = parent
    })
    nodes.push({
      commit,
      lane,
      x: MARGE_VOIE + lane * LARGEUR_VOIE,
      y: HAUTEUR_LIGNE / 2 + row * HAUTEUR_LIGNE,
      couleur: '',
      ...(brancheDeCommit(commit.refs) ? { branche: brancheDeCommit(commit.refs) } : {})
    })
  })

  /*
    LA CATÉGORIE SURVIT, LA POSITION NON.

    Le tracé épinglait chaque commit dans une des TROIS colonnes (fermé à gauche, `main` au centre à
    `280 + n * 64`, ouvert à droite), plus 480 px de marge morte : mesuré 2 952 px de large, presque
    tout vide, et il fallait défiler horizontalement pour lire un sujet. SourceTree fait l'inverse —
    une gouttière étroite, le texte collé à droite — et c'est ce que l'utilisateur a demandé le
    2026-09-15. On garde `side` : il ne commande plus le x, il sert la légende et le style du trait.
  */
  if (axes) {
    nodes.forEach((node) => {
      node.side = axes.main.has(node.commit.hash)
        ? 'main'
        : axes.ouvertes.has(node.commit.hash)
          ? 'open'
          : 'closed'
    })
  }

  /*
    LA COULEUR D'UNE VOIE, tirée du nom de la branche qui l'occupe.

    Une voie est un emplacement réutilisé au fil du temps : on la nomme d'après la PREMIÈRE branche
    rencontrée dessus (celle du haut, la plus récente). Sans nom connu, la voie se colore d'après son
    numéro — imprévisible à l'œil, mais toujours la même d'un affichage à l'autre.
  */
  const brancheParVoie = new Map<number, string>()
  nodes.forEach((node) => {
    if (node.branche && !brancheParVoie.has(node.lane)) brancheParVoie.set(node.lane, node.branche)
  })
  const couleurParVoie = new Map<number, string>(
    nodes.map((node) => [node.lane, couleurDeVoie(node.lane, brancheParVoie.get(node.lane))])
  )
  nodes.forEach((node) => {
    // Un commit qui PORTE une branche est sa tete : il prend la couleur de CETTE branche, celle de
    // son etiquette juste a cote. Sinon il prend celle de sa voie. Sans cela, la tete de
    // `feat/cockpit` posee dans la voie de `main` s'affichait aux couleurs de `main`, a un
    // centimetre d'une etiquette d'une autre couleur.
    node.couleur = node.branche
      ? couleurDeBranche(node.branche)
      : (couleurParVoie.get(node.lane) ?? couleurDeVoie(node.lane))
  })

  const nodeByHash = new Map(nodes.map((node) => [node.commit.hash, node]))
  const edges: GitGraphLayoutEdge[] = nodes.flatMap((node) =>
    node.commit.parents.flatMap((parent) => {
      const target = nodeByHash.get(parent)
      if (!target) return []
      const lane = laneByHash.get(parent) ?? node.lane
      return [
        {
          from: node,
          to: target,
          lane,
          // Le trait prend la couleur de la voie qu'il REJOINT : c'est la ligne qu'on suit des yeux.
          couleur: couleurParVoie.get(lane) ?? node.couleur
        }
      ]
    })
  )
  /**
   * Les SAUTS de la ligne principale, tracés explicitement.
   *
   * Sans eux, le trou laissé par un parent non chargé se lit comme une donnée cassée : la ligne
   * principale n'est qu'une somme de segments parent→enfant, et aucune colonne n'est dessinée derrière.
   * Ces arêtes sont MARQUÉES pour que le rendu les distingue d'une parenté réelle — les inventer sans
   * les signaler serait le mensonge inverse, une histoire continue là où elle est absente.
   */
  for (const elision of elisions ?? []) {
    const from = nodeByHash.get(elision.from)
    const to = nodeByHash.get(elision.to)
    if (!from || !to) continue
    edges.push({
      from,
      to,
      lane: from.lane,
      couleur: from.couleur,
      elidee: true,
      omis: elision.omis
    })
  }

  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1))
  return {
    nodes,
    edges,
    // La gouttière, et RIEN d'autre : la largeur ne réserve plus de place au texte, qui vit
    // désormais dans les colonnes HTML voisines et non dans le SVG.
    width: MARGE_VOIE * 2 + (laneCount - 1) * LARGEUR_VOIE,
    height: Math.max(HAUTEUR_LIGNE, nodes.length * HAUTEUR_LIGNE)
  }
}
