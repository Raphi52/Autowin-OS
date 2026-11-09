import { describe, expect, it } from 'vitest'
import { defaultGit, observerGit, tryGit, tryGitAsync } from './worktree-manager-outils'

/**
 * Chaque commande git lancée par les outils signale son début et sa fin à l'observateur installé
 * par le worker. Sans ce signal, un délai qui expire ne sait pas nommer l'étape qui attendait.
 */
describe('commandes git signalées à l’observateur', () => {
  it('tryGit signale le début puis la fin d’une commande réussie, avec son code 0', () => {
    const evenements: unknown[] = []
    observerGit((evenement) => evenements.push(evenement))
    try {
      tryGit(process.cwd(), ['--version'])
    } finally {
      observerGit(undefined)
    }
    expect(evenements).toEqual([
      { phase: 'debut', id: expect.any(Number), commande: 'git --version', ms: expect.any(Number) },
      {
        phase: 'fin',
        id: expect.any(Number),
        commande: 'git --version',
        ms: expect.any(Number),
        code: 0
      }
    ])
  })

  // Une commande ASYNCHRONE (`tryGitAsync`) tourne pendant que le worker reste libre. Elle doit être
  // signalée comme les autres : sinon, au délai, « aucune commande git en cours » serait faux.
  it('tryGitAsync signale le début puis la fin, avec le même identifiant', async () => {
    const evenements: Array<{ phase: string; id: number; code?: number }> = []
    observerGit((evenement) => evenements.push(evenement))
    try {
      await tryGitAsync(process.cwd(), ['--version'])
    } finally {
      observerGit(undefined)
    }
    expect(evenements.map((e) => e.phase)).toEqual(['debut', 'fin'])
    expect(evenements[1]?.id).toBe(evenements[0]?.id)
    expect(evenements[1]?.code).toBe(0)
  })

  // Deux commandes asynchrones en parallèle : chacune garde son identifiant, pour que la fin de l'une
  // ne puisse pas être prise pour la fin de l'autre au moment du délai.
  it('deux commandes asynchrones en parallèle ont chacune leur identifiant', async () => {
    const evenements: Array<{ phase: string; id: number }> = []
    observerGit((evenement) => evenements.push(evenement))
    try {
      await Promise.all([
        tryGitAsync(process.cwd(), ['--version']),
        tryGitAsync(process.cwd(), ['--version'])
      ])
    } finally {
      observerGit(undefined)
    }
    const debuts = evenements.filter((e) => e.phase === 'debut').map((e) => e.id)
    expect(debuts).toHaveLength(2)
    expect(new Set(debuts).size).toBe(2)
  })

  // Jumeau : une commande en échec ne jette pas, et sa fin porte le code non nul.
  it('tryGit signale la fin d’une commande en échec avec son code, sans jeter', () => {
    const evenements: Array<{ phase: string; code?: number }> = []
    observerGit((evenement) => evenements.push(evenement))
    let resultat: { code: number } | undefined
    try {
      resultat = tryGit(process.cwd(), ['rev-parse', '--verify', 'refs/inexistant-xyz-lot7'])
    } finally {
      observerGit(undefined)
    }
    expect(resultat?.code).not.toBe(0)
    expect(evenements.at(-1)).toMatchObject({ phase: 'fin', code: resultat?.code })
  })

  it('defaultGit signale aussi la fin d’une commande qui jette', () => {
    const evenements: Array<{ phase: string; code?: number }> = []
    observerGit((evenement) => evenements.push(evenement))
    try {
      expect(() =>
        defaultGit(process.cwd(), ['rev-parse', '--verify', 'refs/inexistant-xyz-lot7'])
      ).toThrow()
    } finally {
      observerGit(undefined)
    }
    expect(evenements.map((e) => e.phase)).toEqual(['debut', 'fin'])
    expect(evenements.at(-1)?.code).not.toBe(0)
  })

  // L'étiquette ne reprend pas l'option `-c clé=valeur` : elle doit dire la commande, pas la plomberie.
  it('l’étiquette d’une commande saute l’option `-c` et garde la commande lisible', () => {
    const evenements: Array<{ commande?: string }> = []
    observerGit((evenement) => evenements.push(evenement))
    try {
      tryGit(process.cwd(), ['-c', 'core.longpaths=true', 'rev-parse', '--verify', 'refs/x-lot7'])
    } finally {
      observerGit(undefined)
    }
    expect(evenements[0]?.commande).toBe('git rev-parse --verify refs/x-lot7')
  })
})
