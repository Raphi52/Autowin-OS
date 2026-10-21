import { describe, expect, it, vi } from 'vitest'
import type { ScheduledTask, TaskOccurrence } from '../task-manager/types'
import { dispatcherAvecVeille, resumerPasse } from './dispatch-veille'
import type { ResultatPasse } from './passe'

/**
 * L'enrobage qui fait d'une passe de veille une tâche planifiée.
 *
 * Ce qu'il protège avant tout : que RIEN ne change pour les tâches existantes. Le champ `action` est
 * optionnel, et une tâche déjà enregistrée sur le disque ne le porte pas — si l'enrobage se trompait de
 * branche, il enverrait une passe de veille à la place d'un prompt utilisateur, ou l'inverse.
 */

const tache = (partiel: Partial<ScheduledTask> = {}): ScheduledTask =>
  ({
    id: 't1',
    title: 'Tâche',
    prompt: 'fais quelque chose',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'new', title: 'x', category: 'claude', provider: 'claude' },
    nextRunAt: null,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...partiel
  }) as ScheduledTask

const occurrence = { id: 'o1' } as TaskOccurrence

const passe = (partiel: Partial<ResultatPasse> = {}): ResultatPasse => ({
  retenus: 2,
  refuses: [],
  echecs: [],
  sourcesWeb: 1,
  stock: { candidats: [], echecs: [] },
  ...partiel
})

describe('aiguillage', () => {
  it('DÉLÈGUE une tâche sans `action` : les tâches historiques ne changent pas', async () => {
    // Le cas qui compte le plus : toutes les tâches déjà sur le disque sont dans cet état.
    const suivant = { run: vi.fn(async () => ({ status: 'completed' as const })) }
    const executerPasse = vi.fn(async () => passe())
    const d = dispatcherAvecVeille({ suivant, executerPasse })

    await d.run(tache(), occurrence)

    expect(suivant.run).toHaveBeenCalledTimes(1)
    expect(executerPasse).not.toHaveBeenCalled()
  })

  it('délègue aussi une tâche explicitement `chat`', async () => {
    const suivant = { run: vi.fn(async () => ({ status: 'completed' as const })) }
    const executerPasse = vi.fn(async () => passe())
    const d = dispatcherAvecVeille({ suivant, executerPasse })

    await d.run(tache({ action: 'chat' }), occurrence)

    expect(suivant.run).toHaveBeenCalledTimes(1)
    expect(executerPasse).not.toHaveBeenCalled()
  })

  it('transmet les puits de rappel INTACTS au dispatcheur suivant', async () => {
    // Les perdre priverait le planificateur des règlements de coût et des revendications de mutation.
    const suivant = { run: vi.fn(async () => ({ status: 'completed' as const })) }
    const d = dispatcherAvecVeille({ suivant, executerPasse: async () => passe() })
    const claims = vi.fn()
    const usage = vi.fn()

    await d.run(tache(), occurrence, claims, usage)

    expect(suivant.run).toHaveBeenCalledWith(expect.anything(), occurrence, claims, usage)
  })

  it('exécute la passe pour une tâche `veille`, sans toucher au chat', async () => {
    const suivant = { run: vi.fn(async () => ({ status: 'completed' as const })) }
    const executerPasse = vi.fn(async () => passe({ retenus: 3 }))
    const d = dispatcherAvecVeille({ suivant, executerPasse })

    const resultat = await d.run(tache({ action: 'veille' }), occurrence)

    expect(executerPasse).toHaveBeenCalledTimes(1)
    expect(suivant.run).not.toHaveBeenCalled()
    expect(resultat.status).toBe('completed')
  })
})

describe('ce que l’occurrence raconte', () => {
  it('une passe qui n’a RIEN pu lire est un ÉCHEC, pas un succès à zéro', async () => {
    // Sans cette distinction, une veille définitivement muette resterait verte indéfiniment — le même
    // « zéro qui se lit aucun » corrigé ailleurs dans ce dépôt.
    const d = dispatcherAvecVeille({
      suivant: { run: async () => ({ status: 'completed' as const }) },
      executerPasse: async () =>
        passe({
          retenus: 0,
          refuses: [],
          echecs: [{ concurrent: 'Kimi', url: 'https://k.test', detail: 'HTTP 404', vuLe: 'x' }]
        })
    })

    const resultat = await d.run(tache({ action: 'veille' }), occurrence)

    expect(resultat.status).toBe('failed')
    expect(resultat.error).toContain('1 source muette')
  })

  // Défaut relevé par la relecture de conv-1032 : la passe planifiée trie AUSSI les candidats
  // internes du dépôt. Un seul interne retenu ou refusé (« deja connu », le cas courant) suffisait à
  // rendre verte une passe dont aucun scout web n'avait lu sa page.
  const muette = (concurrent: string): ResultatPasse['echecs'][number] => ({
    concurrent,
    url: `https://${concurrent.toLowerCase()}.test`,
    detail: 'scout sorti en 1 : sans message',
    vuLe: 'x'
  })
  const refusInterne = {
    raison: 'deja connu' as const,
    brut: { concurrent: 'Autowin OS', titre: 'défaut connu', url: 'src/main/x.ts:12' }
  }

  it.each([
    ['retenus', { retenus: 3, refuses: [] }],
    ['refusés', { retenus: 0, refuses: [refusInterne] }]
  ])(
    'toutes les sources WEB muettes = ÉCHEC, même avec des candidats internes %s',
    async (_cas, tries) => {
      const d = dispatcherAvecVeille({
        suivant: { run: async () => ({ status: 'completed' as const }) },
        executerPasse: async () =>
          passe({ ...tries, sourcesWeb: 2, echecs: [muette('Codex'), muette('Cursor')] })
      })

      const resultat = await d.run(tache({ action: 'veille' }), occurrence)

      expect(resultat.status).toBe('failed')
      expect(resultat.error).toMatch(/aucune source web lue/i)
      expect(resultat.error).toContain('2 sources muettes')
    }
  )

  it('une source web muette parmi d’autres LUES reste un succès', async () => {
    // Le garde-fou inverse : une page morte (Kimi) ne doit pas rendre rouge chaque passe.
    const d = dispatcherAvecVeille({
      suivant: { run: async () => ({ status: 'completed' as const }) },
      executerPasse: async () => passe({ retenus: 3, sourcesWeb: 2, echecs: [muette('Kimi')] })
    })

    expect((await d.run(tache({ action: 'veille' }), occurrence)).status).toBe('completed')
  })

  it('une passe qui ne trouve rien de NEUF reste un succès', async () => {
    // Zéro retenu avec des sources lues, c'est « rien de neuf » : une information, pas une panne.
    const d = dispatcherAvecVeille({
      suivant: { run: async () => ({ status: 'completed' as const }) },
      executerPasse: async () => passe({ retenus: 0, refuses: [], echecs: [] })
    })

    expect((await d.run(tache({ action: 'veille' }), occurrence)).status).toBe('completed')
  })

  it('une passe qui LÈVE devient un échec portant la cause', async () => {
    const d = dispatcherAvecVeille({
      suivant: { run: async () => ({ status: 'completed' as const }) },
      executerPasse: async () => {
        throw new Error('binaire scout introuvable')
      }
    })

    const resultat = await d.run(tache({ action: 'veille' }), occurrence)

    expect(resultat.status).toBe('failed')
    expect(resultat.error).toBe('binaire scout introuvable')
  })

  it('le résumé nomme les sources muettes, et les tait quand il n’y en a pas', () => {
    expect(resumerPasse(passe({ retenus: 2, refuses: [] }))).toBe('Veille : 2 retenus, 0 refusés.')
    expect(
      resumerPasse(
        passe({
          retenus: 1,
          echecs: [{ concurrent: 'X', url: 'u', detail: 'd', vuLe: 'v' }]
        })
      )
    ).toContain('1 source muette')
  })
})
