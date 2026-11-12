import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Defaut vecu (2026-09-01) : l'utilisateur ecrit « lance une conversation test. », et
 * l'app cree « Test — conversation de verification »... DEUX fois (vide).
 * Ces tests verrouillent les deux corrections cote code, la ou une consigne de prompt avait lache.
 */
describe('create_conversation', () => {
  const monter = () => {
    // Le fil créé garde son historique (vide) ; `listResumes` n'en rend que les métadonnées, comme le store.
    type Cree = {
      id: string
      title: string
      provider: string
      createdAt: number
      messages: never[]
    }
    const creees: Cree[] = []
    const os = {
      conversations: {
        get: (id: string) =>
          id === 'conv-71'
            ? { id, messages: [{ role: 'user', content: 'lance une conversation test.' }] }
            : creees.find((c) => c.id === id),
        listResumes: () =>
          creees.map(({ id, title, provider, createdAt }) => ({ id, title, provider, createdAt })),
        create: (p: { title: string; provider: string }) => {
          const c: Cree = {
            id: `conv-${72 + creees.length}`,
            ...p,
            createdAt: Date.now(),
            messages: []
          }
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

  // fix-ok: cause mesurée — la réponse du second envoi identique était le résumé, sans `messages` :
  // « expected { id: 'conv-72', …(4) } to match object { …, messages: [] } » (exit 1) avant le correctif
  // de commands/conversations.ts. Le double ne rend plus le fil créé sans son historique.
  it('le second envoi identique rend le fil entier, messages compris, comme avant la lecture par résumé', async () => {
    const { bus } = monter()
    const premier = await bus.exec('create_conversation', {}, 'conv-71')
    const second = await bus.exec('create_conversation', {}, 'conv-71')
    expect(second.data).toMatchObject({
      id: (premier.data as { id: string }).id,
      reprise: true,
      messages: []
    })
  })

  it('respecte un titre explicite', async () => {
    const { bus } = monter()
    const res = await bus.exec('create_conversation', { title: 'Audit factures' }, 'conv-71')
    expect(res).toMatchObject({ ok: true, data: { title: 'Audit factures' } })
  })
})
