import { describe, expect, it } from 'vitest'
import {
  LATE_BEHIND_THRESHOLD,
  formatBytes,
  layoutWorktreeMap,
  summarizeWorktreeMap,
  worktreeLabel,
  type WorktreeMapEntry
} from './worktree-map'

function entry(over: Partial<WorktreeMapEntry> & { path: string; head: string }): WorktreeMapEntry {
  return { detached: true, locked: false, ...over }
}

describe('summarizeWorktreeMap', () => {
  it('ne compte comme recuperable que ce qui est propre AVEC certitude', () => {
    const totals = summarizeWorktreeMap([
      entry({ path: '/a', head: 'aaa', dirtyFiles: 0, sizeBytes: 100 }),
      entry({ path: '/b', head: 'bbb', dirtyFiles: 3, sizeBytes: 200 }),
      // saleté NON mesurée : ni sale, ni propre, et surtout pas recuperable.
      entry({ path: '/c', head: 'ccc', sizeBytes: 400 })
    ])
    expect(totals).toMatchObject({ count: 3, dirty: 1, clean: 1, unknown: 1 })
    expect(totals.totalBytes).toBe(700)
    expect(totals.reclaimableBytes).toBe(100)
  })

  it('retient le retard maximum', () => {
    const totals = summarizeWorktreeMap([
      entry({ path: '/a', head: 'aaa', behind: 4 }),
      entry({ path: '/b', head: 'bbb', behind: 28 }),
      entry({ path: '/c', head: 'ccc' })
    ])
    expect(totals.maxBehind).toBe(28)
  })
})

describe('layoutWorktreeMap — territoire', () => {
  const layout = layoutWorktreeMap([
    entry({ path: '/sale', head: 'aaa', behind: 0, dirtyFiles: 5 }),
    entry({ path: '/propre', head: 'aaa', behind: 0, dirtyFiles: 0 })
  ])

  it('fait monter toute copie sale au-dessus du tronc et descendre toute copie propre en dessous', () => {
    const live = layout.lines.filter((line) => line.kind === 'live')
    const closed = layout.lines.filter((line) => line.kind === 'closed')
    expect(live).toHaveLength(1)
    expect(closed).toHaveLength(1)
    // La regle est verifiee sur CHAQUE point du trace, pas seulement sur le terminus :
    // un segment qui traverserait le tronc casserait la lecture d'un coup d'oeil.
    for (const point of live[0].points.slice(1)) expect(point[1]).toBeLessThan(layout.trunkY)
    for (const point of closed[0].points.slice(1)) expect(point[1]).toBeGreaterThan(layout.trunkY)
  })

  it('etiquette le terminus vivant avec le nombre de fichiers et accorde le singulier', () => {
    expect(layout.lines.find((line) => line.kind === 'live')?.label).toBe('EN TRAVAUX · 5 fichiers')
    const single = layoutWorktreeMap([entry({ path: '/x', head: 'aaa', dirtyFiles: 1 })])
    expect(single.lines[0].label).toBe('EN TRAVAUX · 1 fichier')
  })

  it('porte le chemin du worktree sur la station, pour que le clic sache de quoi il parle', () => {
    const live = layout.lines.find((line) => line.kind === 'live')
    expect(live?.stations.map((station) => station.entryPath)).toEqual(['/sale'])
    expect(live?.stations[0].dirtyFiles).toBe(5)
    // Une station propre ne porte AUCUN compteur : l'absence doit rester une absence.
    expect(
      layout.lines.find((line) => line.kind === 'closed')?.stations[0].dirtyFiles
    ).toBeUndefined()
  })

  it('place une saleté non mesurée sur une ligne inconnue, jamais fermée', () => {
    const unknownLayout = layoutWorktreeMap([entry({ path: '/inconnu', head: 'aaa' })])

    expect(unknownLayout.lines).toHaveLength(1)
    expect(unknownLayout.lines[0]).toMatchObject({ kind: 'unknown', label: 'INCONNU' })
    expect(unknownLayout.lines.some((line) => line.kind === 'closed')).toBe(false)
  })
})

describe('layoutWorktreeMap — correspondances et cassures', () => {
  const layout = layoutWorktreeMap([
    entry({ path: '/a', head: 'aaa', behind: 0, dirtyFiles: 0 }),
    entry({ path: '/b', head: 'bbb', behind: 1, dirtyFiles: 0 }),
    entry({ path: '/c', head: 'ccc', behind: 23, dirtyFiles: 0 })
  ])

  it('groupe une correspondance par commit et les ordonne du plus a jour au plus en retard', () => {
    expect(layout.interchanges.map((ic) => ic.behind)).toEqual([0, 1, 23])
    expect(layout.interchanges.map((ic) => ic.head)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('declare les commits sautés par une cassure, et ignore un ecart de 1', () => {
    // 0 -> 1 : commits consecutifs, aucun trou a declarer.
    expect(layout.interchanges[1].skipped).toBeUndefined()
    expect(layout.interchanges[1].breakX).toBeUndefined()
    // 1 -> 23 : 21 commits sans aucun worktree, et c'est le message.
    expect(layout.interchanges[2].skipped).toBe(21)
    expect(layout.interchanges[2].breakX).toBeGreaterThan(layout.interchanges[1].x)
    expect(layout.interchanges[2].breakX).toBeLessThan(layout.interchanges[2].x)
  })

  it('passe en ambre au seuil de retard, et pas un commit avant', () => {
    const at = layoutWorktreeMap([
      entry({ path: '/x', head: 'x', behind: LATE_BEHIND_THRESHOLD - 1 }),
      entry({ path: '/y', head: 'y', behind: LATE_BEHIND_THRESHOLD })
    ])
    expect(at.interchanges.map((ic) => ic.late)).toEqual([false, true])
  })

  it('ecarte les correspondances selon la largeur reellement consommee, jamais selon le retard', () => {
    // Meme retards, mais la premiere correspondance porte 1 copie et la seconde 4.
    const light = layoutWorktreeMap([
      entry({ path: '/a', head: 'aaa', behind: 0, dirtyFiles: 0 }),
      entry({ path: '/b', head: 'bbb', behind: 1, dirtyFiles: 0 })
    ])
    // Un retard enorme entre deux correspondances ne doit RIEN changer a leur ecart :
    // c'est exactement l'echelle proportionnelle qu'on a refusee (canevas vide).
    const distant = layoutWorktreeMap([
      entry({ path: '/a', head: 'aaa', behind: 0, dirtyFiles: 0 }),
      entry({ path: '/b', head: 'bbb', behind: 240, dirtyFiles: 0 })
    ])
    const gap = (l: typeof light): number => l.interchanges[1].x - l.interchanges[0].x
    expect(gap(distant)).toBe(gap(light))
  })

  it('grandit en largeur quand une correspondance porte plus de copies', () => {
    const one = layoutWorktreeMap([entry({ path: '/a', head: 'aaa', dirtyFiles: 0 })])
    const many = layoutWorktreeMap([
      entry({ path: '/a', head: 'aaa', dirtyFiles: 0 }),
      entry({ path: '/b', head: 'aaa', dirtyFiles: 0 }),
      entry({ path: '/c', head: 'aaa', dirtyFiles: 0 })
    ])
    // Meme abscisse (une seule correspondance) mais plus de voies -> plus haut, pas plus large.
    expect(many.interchanges).toHaveLength(1)
    expect(many.height).toBeGreaterThan(one.height)
  })

  it('ne trace que des segments a 0, 45 ou 90 degres', () => {
    for (const line of layout.lines) {
      for (let i = 1; i < line.points.length; i += 1) {
        const dx = Math.abs(line.points[i][0] - line.points[i - 1][0])
        const dy = Math.abs(line.points[i][1] - line.points[i - 1][1])
        const straight = dx === 0 || dy === 0
        const diagonal = dx === dy
        expect(straight || diagonal).toBe(true)
      }
    }
  })
})

describe('libellés', () => {
  it('prefere la branche, et retombe sur le dossier quand la copie est detachee', () => {
    expect(worktreeLabel(entry({ path: '/x/y', head: 'a', branch: 'fix/judge' }))).toBe('fix/judge')
    expect(worktreeLabel(entry({ path: 'C:\\runs\\wt-edilot3', head: 'a' }))).toBe('wt-edilot3')
  })

  it('formate les octets sans fausse precision', () => {
    expect(formatBytes(868_000_000)).toBe('868 Mo')
    expect(formatBytes(2_400_000_000)).toBe('2.4 Go')
    expect(formatBytes(512)).toBe('512 o')
  })
})
