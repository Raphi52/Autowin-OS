import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Defaut vecu conv-71 (2026-09-01) : l'utilisateur ecrit « lance une conversation test. », et
 * l'app cree « Test — conversation de verification »... DEUX fois (conv-72 puis conv-73, vide).
 * Ces tests verrouillent les deux corrections cote code, la ou une consigne de prompt avait lache.
 */
describe('create_conversation', () => {
  const monter = () => {
    const creees: { id: string; title: string; provider: string; createdAt: number }[] = []
    const os = {
      conversations: {
        get: (id: string) =>
          id === 'conv-71'
            ? { id, messages: [{ role: 'user', content: 'lance une conversation test.' }] }
            : undefined,
        list: () => [...creees],
        create: (p: { title: string; provider: string }) => {
          const c = { id: `conv-${72 + creees.length}`, ...p, createdAt: Date.now() }
          creees.push(c)
          return c
        }
      }
    } as never
    return { bus: new AppCommandBus(os, () => {}), creees }
  }

  it('nomme la conversation avec LES MOTS de l utilisateur quand aucun titre n est donne', async () => {
    const { bus, creees } = monter()
    const res = await bus.exec('create_conversation', {}, 'conv-71')
    expect(res).toMatchObject({ ok: true, data: { title: 'lance une conversation test.' } })
    expect(creees).toHaveLength(1)
  })

  it('ne cree PAS de deuxieme conversation quand le meme appel part deux fois', async () => {
    const { bus, creees } = monter()
    const premier = await bus.exec('create_conversation', {}, 'conv-71')
    const second = await bus.exec('create_conversation', {}, 'conv-71')
    expect(creees).toHaveLength(1)
    expect((second.data as { id: string }).id).toBe((premier.data as { id: string }).id)
    expect(second.data).toMatchObject({ reprise: true })
  })

  it('respecte un titre explicite', async () => {
    const { bus } = monter()
    const res = await bus.exec('create_conversation', { title: 'Audit factures' }, 'conv-71')
    expect(res).toMatchObject({ ok: true, data: { title: 'Audit factures' } })
  })
})
