import { describe, expect, it } from 'vitest'
import type { GitGraphCommit } from '../../../shared/git-graph'
import {
  HAUTEUR_LIGNE,
  LARGEUR_VOIE,
  MARGE_VOIE,
  layoutGitGraph,
  projectGitGraphAxes
} from './GitGraphLayout'
import { couleurDeBranche } from './git-graph-couleurs'

function commit(hash: string, parents: string[] = []): GitGraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    refs: [],
    author: 'Test',
    date: '2026-07-23T00:00:00Z',
    subject: hash
  }
}

describe('layoutGitGraph', () => {
  it('place les branches d’un merge sur des lanes distinctes et relie tous les parents visibles', () => {
    const layout = layoutGitGraph([
      commit('merge', ['left', 'right']),
      commit('left', ['base']),
      commit('right', ['base']),
      commit('base')
    ])

    expect(layout.nodes.find((node) => node.commit.hash === 'left')?.lane).not.toBe(
      layout.nodes.find((node) => node.commit.hash === 'right')?.lane
    )
    expect(layout.edges).toHaveLength(4)
    // La largeur est celle de la GOUTTIÈRE seule : elle suit le nombre de voies, pas un plancher de
    // 720 px hérité du temps où le sujet du commit était dessiné DANS le SVG.
    expect(layout.width).toBe(MARGE_VOIE * 2 + LARGEUR_VOIE)
  })

  it('ignore proprement un parent hors de la fenêtre d’historique', () => {
    const layout = layoutGitGraph([commit('tip', ['outside'])])

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
  })
})

describe('projectGitGraphAxes', () => {
  const ref = (fullName: string, hash: string, kind: 'local' | 'remote' | 'tag' = 'local') => ({
    name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ''),
    fullName,
    kind,
    hash,
    isHead: false
  })

  it('reserve ouvert aux branches et pas aux tags seuls', () => {
    const commits = [commit('main-tip'), commit('open-tip'), commit('tag-only')]
    const axes = projectGitGraphAxes(
      commits,
      [
        ref('refs/heads/main', 'main-tip'),
        ref('refs/heads/feature', 'open-tip'),
        ref('refs/tags/rescue/test', 'tag-only', 'tag')
      ],
      {
        mainLineHashes: ['main-tip'],
        mergedIntoMainHashes: ['main-tip'],
        openBranchHashes: ['open-tip']
      }
    )
    expect(axes?.ouvertes.has('open-tip')).toBe(true)
    expect(axes?.ouvertes.has('tag-only')).toBe(false)
  })

  it('reconnait main sur une remote non nommee origin sans remote HEAD', () => {
    const axes = projectGitGraphAxes(
      [commit('feature-tip'), commit('main-tip')],
      [
        ref('refs/remotes/upstream/main', 'main-tip', 'remote'),
        ref('refs/remotes/upstream/feature', 'feature-tip', 'remote')
      ],
      {
        mainLineHashes: ['main-tip'],
        mergedIntoMainHashes: ['main-tip'],
        openBranchHashes: ['feature-tip']
      }
    )
    expect(axes?.main.has('main-tip')).toBe(true)
    expect(axes?.ouvertes.has('feature-tip')).toBe(true)
  })
})

describe('les voies sont LIBÉRÉES : sinon le graphe part en escalier vers la droite', () => {
  /**
   * Constaté à l'écran : en bas de la topologie, une seconde colonne de commits dérivait vers la
   * droite, comme un deuxième dépôt. MESURÉ sur ce dépôt : 38 voies pour 271 commits, largeur 2 952 px,
   * alors que 2 commits seulement ont un parent hors de la fenêtre lue.
   *
   * La cause n'est donc pas les orphelins mais les FUSIONS. Une fusion réserve une voie pour son second
   * parent ; puis le premier parent du commit suivant se trouve être ce même hash, et DEUX voies
   * attendent le même commit. Quand il arrive, une seule est consommée — l'autre garde son hash pour
   * toujours, et chaque fusion suivante doit chercher sa voie plus à droite.
   */
  /**
   * La forme RÉELLE, relevée sur ce dépôt : plusieurs commits partagent le même premier parent (le
   * motif d'un `autostash` ou de branches repartant d'un même point). Rows 7 et 8 réservaient
   * `c654ea2` alors que la voie 0 l'attendait déjà ; row 13 l'a placé en voie 0, et les voies 2 et 3
   * ont gardé ce hash pour toujours. Compté sur les 271 commits : 35 réservations en double, donc 35
   * voies perdues, et 38 voies au total pour un dépôt qui n'en occupe jamais plus de trois à la fois.
   *
   * Trois frères partageant un parent occupent LÉGITIMEMENT trois voies. Ce que ce test vérifie, c'est
   * qu'une fois ce parent placé, les voies sont RENDUES au groupe suivant.
   */
  it('n’épingle PLUS les commits en trois colonnes : une seule gouttière étroite', () => {
    /*
      LE CHANGEMENT DEMANDÉ (2026-09-15) : « j'aime bien SourceTree, le côté graphique ».
      L'ancien tracé épinglait les commits en TROIS colonnes (fermé à gauche, main au centre, ouvert
      à droite) séparées de 64 px, plus 480 px de marge morte à droite : mesuré, une largeur de
      2 952 px dont l'essentiel était vide, et la lecture demandait un défilement horizontal.

      SourceTree fait l'inverse : une gouttière étroite à gauche, et le texte juste à côté. Ce test
      interdit le retour de l'épinglage — les x ne doivent dépendre QUE de la voie.
    */
    const commits = [
      commit('main-tip', ['main-old', 'closed-tip']),
      commit('open-tip', ['main-old']),
      commit('closed-tip', ['main-old']),
      commit('main-old', ['root']),
      commit('root')
    ]
    const layout = layoutGitGraph(commits, {
      main: new Set(['main-tip', 'main-old', 'root']),
      ouvertes: new Set(['open-tip'])
    })
    // La gouttière tient dans une colonne de vue, sans défilement horizontal.
    expect(layout.width).toBeLessThanOrEqual(200)
    // x ne dépend QUE de la voie : deux commits de voies différentes s'écartent de la largeur de voie,
    // jamais de 280 px + une catégorie.
    const parVoie = new Map(layout.nodes.map((node) => [node.lane, node.x]))
    ;[...parVoie.keys()].forEach((lane) => {
      expect(parVoie.get(lane)).toBe(layout.nodes.find((n) => n.lane === lane)?.x)
    })
    const xs = [...new Set(layout.nodes.map((node) => node.x))].sort((a, b) => a - b)
    xs.slice(1).forEach((x, index) => expect(x - xs[index]).toBeLessThanOrEqual(LARGEUR_VOIE))
    // La catégorie SURVIT : elle sert la couleur et la légende, elle ne commande plus la position.
    expect(layout.nodes.find((n) => n.commit.hash === 'open-tip')?.side).toBe('open')
    expect(layout.nodes.find((n) => n.commit.hash === 'closed-tip')?.side).toBe('closed')
  })

  it('aligne chaque ligne du graphe sur UNE ligne de texte', () => {
    // Le tracé est une colonne D'UN TABLEAU : si le pas vertical du SVG n'est pas exactement celui
    // des lignes HTML, les points dérivent de leur commit et le graphe ment sur qui est qui.
    const layout = layoutGitGraph([commit('a', ['b']), commit('b'), commit('c')])
    const ys = layout.nodes.map((node) => node.y)
    expect(ys[1] - ys[0]).toBe(HAUTEUR_LIGNE)
    expect(ys[2] - ys[1]).toBe(HAUTEUR_LIGNE)
    expect(layout.height).toBe(3 * HAUTEUR_LIGNE)
  })

  it('donne à chaque nœud une couleur STABLE, pas un tirage par rendu', () => {
    const commits = [commit('a', ['b']), commit('b')]
    const premier = layoutGitGraph(commits)
    const second = layoutGitGraph(commits)
    expect(premier.nodes[0].couleur).toMatch(/^hsl\(/)
    expect(premier.nodes.map((n) => n.couleur)).toEqual(second.nodes.map((n) => n.couleur))
    expect(premier.edges[0].couleur).toMatch(/^hsl\(/)
  })

  it('tire la couleur d’une voie du NOM de branche qu’elle porte', () => {
    // Deux dépôts différents, la même branche : la même couleur. C'est ce qui rend l'œil capable de
    // suivre `feat/cockpit` d'un écran à l'autre.
    const avecRef: GitGraphCommit = { ...commit('tip'), refs: ['HEAD -> feat/cockpit'] }
    const layout = layoutGitGraph([avecRef])
    expect(layout.nodes[0].couleur).toBe(couleurDeBranche('feat/cockpit'))
  })

  /** CAS LIMITE — aucun commit : pas d'exception, une disposition vide et bornée. */
  it('rend une disposition vide sans jeter quand il n’y a aucun commit', () => {
    const layout = layoutGitGraph([])
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  const fratrie = (parent: string, prefixe: string): GitGraphCommit[] => [
    commit(`${prefixe}1`, [parent]),
    commit(`${prefixe}2`, [parent]),
    commit(`${prefixe}3`, [parent])
  ]

  it('rend les voies au groupe suivant une fois le parent commun placé', () => {
    const commits = [...fratrie('a', 'x'), commit('a', []), ...fratrie('b', 'y'), commit('b', [])]
    const layout = layoutGitGraph(commits)
    const voieMax = Math.max(...layout.nodes.map((node) => node.lane))
    // Sans libération, la seconde fratrie repart en voies 3, 4, 5 (mesuré : voie max 4).
    //
    // La borne est un MAXIMUM et non une égalité : une première version de ce test exigeait exactement
    // 2, en supposant qu'une fratrie de trois occupe trois voies. Le correctif fait mieux — les frères
    // qui n'attendent plus rien rendent leur voie immédiatement — et cette exigence trop précise
    // encodait ma supposition au lieu du besoin.
    expect(voieMax).toBeLessThanOrEqual(2)
  })

  it('à la fin, aucune voie n’attend un commit déjà placé', () => {
    // L'INVARIANT, et la mesure qui l'a révélé : sur les 271 commits du dépôt, 35 voies attendaient un
    // commit déjà tracé ailleurs et 2 un commit hors fenêtre — 37 voies retenues sur 38. C'est cette
    // rétention, et rien d'autre, qui poussait le tracé vers la droite.
    //
    // On le vérifie par la LARGEUR, seule sortie observable du calcul : elle croît avec la voie max.
    const beaucoupDeFratries = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((parent) => [
      ...fratrie(parent, `n${parent}`),
      commit(parent, [])
    ])
    const layout = layoutGitGraph(beaucoupDeFratries)
    const voieMax = Math.max(...layout.nodes.map((node) => node.lane))
    expect(voieMax).toBeLessThanOrEqual(2)
    // Six fratries de trois : la largeur ne doit pas dépendre de leur NOMBRE.
    expect(layout.width).toBe(layoutGitGraph([...fratrie('a', 'na'), commit('a', [])]).width)
  })

  it('ne réserve pas DEUX voies pour le même parent', () => {
    // C'est la cause racine mesurée, isolée : deux commits, un seul parent commun, deux voies. Quand le
    // parent arrive il n'en consomme qu'une, et l'autre est perdue.
    const commits = [commit('x1', ['a']), commit('x2', ['a']), commit('a', []), commit('seul', [])]
    const layout = layoutGitGraph(commits)
    const voieDeSeul = layout.nodes.find((node) => node.commit.hash === 'seul')?.lane
    // `seul` n'a aucun lien : il doit retomber dans une voie libérée, pas ouvrir la troisième.
    expect(voieDeSeul).toBeLessThanOrEqual(1)
  })

  it('un parent hors de la fenêtre lue ne bloque pas une voie', () => {
    // Le dernier commit d'une page de log référence un parent absent : sa voie ne doit pas rester
    // réservée pour un commit qui n'arrivera jamais.
    const commits = [
      commit('a', ['absent-du-log']),
      commit('x', ['y']),
      commit('y', []),
      commit('z', [])
    ]
    const layout = layoutGitGraph(commits)
    expect(Math.max(...layout.nodes.map((node) => node.lane))).toBe(0)
  })
})
