import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Defaut mesure le 2026-09-05 (conv-297 -> conv-300) : un agent a cree une conversation
 * « /curate » puis a tente d'y lancer la skill avec `chat_send`. `chat_send` n'a AUCUNE
 * destination : le texte part en echange ponctuel avec le modele (`os.chat`). Le fil est reste
 * vide, la skill n'a jamais tourne, et le seul retour a ete « Unknown command: /curate » rendu
 * par le modele. Une commande `/` est un chemin d'INTERFACE : elle ne peut pas transiter par
 * `chat_send`. L'outil doit REFUSER de maniere deterministe et nommer `orchestrate`.
 */
describe('chat_send — une commande slash est refusee, pas envoyee au modele', () => {
  function osQuiRepondTouJours(): { appels: string[]; os: unknown } {
    const appels: string[] = []
    const os = {
      executionWorkspace: process.cwd(),
      chat: async (_p: unknown, _r: unknown, messages: Array<{ content: string }>) => {
        appels.push(messages[0].content)
        return { text: 'Unknown command: /curate' }
      },
      conversations: { get: () => undefined, list: () => [] },
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
      runsWithGate: () => [],
      budget: () => ({ spent: 0 })
    }
    return { appels, os }
  }

  it('refuse `/curate` sans appeler le modele et renvoie vers orchestrate', async () => {
    const { appels, os } = osQuiRepondTouJours()
    const bus = new AppCommandBus(os as never, () => undefined)

    const result = await bus.exec('chat_send', { message: '/curate' })

    expect(appels).toEqual([])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('orchestrate')
  })

  it('laisse passer un chemin de fichier absolu', async () => {
    const { appels, os } = osQuiRepondTouJours()
    const bus = new AppCommandBus(os as never, () => undefined)

    const result = await bus.exec('chat_send', { message: '/home/raph/notes.txt que contient ce fichier ?' })

    expect(result.ok).toBe(true)
    expect(appels).toEqual(['/home/raph/notes.txt que contient ce fichier ?'])
  })

  it('laisse passer un message normal', async () => {
    const { appels, os } = osQuiRepondTouJours()
    const bus = new AppCommandBus(os as never, () => undefined)

    const result = await bus.exec('chat_send', { message: 'combien font 2+2 ?' })

    expect(result.ok).toBe(true)
    expect(appels).toEqual(['combien font 2+2 ?'])
  })
})
