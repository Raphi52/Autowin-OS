import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { persistConversations } from './conversations-disk'

/**
 * UN SEUL message « Reprise du fil » PAR CHANTIER, mis à jour au lieu d'être empilé.
 *
 * Vécu dans conv-913 (2026-10-13) : le chantier run-4e20c71a5f68-1 a traversé deux redémarrages de
 * l'app (10:17 puis 10:26). À chacun, le processus principal a AJOUTÉ un nouveau récapitulatif en bas
 * du fil. Deux bulles « Reprise du fil… » pour le même chantier, dont la seconde cachait à l'écran le
 * tour encore vivant.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-reprise-chantier-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const RUN = 'run-4e20c71a5f68-1'

describe('ConversationStore — reprise du fil d’un chantier', () => {
  it('le premier redémarrage AJOUTE le message, le suivant le MET À JOUR en place', () => {
    const store = new ConversationStore(() => 1000)
    const c = store.create({ title: 'chantier', provider: 'claude' })
    store.append(c.id, { role: 'user', content: 'vazy' })

    expect(store.noterRepriseDuChantier(c.id, RUN, () => 'reprise 1')).toBe('ajoute')
    store.append(c.id, { role: 'user', content: 'finis' })
    const precedents: (string | undefined)[] = []
    expect(
      store.noterRepriseDuChantier(c.id, RUN, (precedent) => {
        precedents.push(precedent)
        return `${precedent} + reprise 2`
      })
    ).toBe('mis-a-jour')

    const messages = store.get(c.id)!.messages
    expect(messages.map((m) => m.content)).toEqual(['vazy', 'reprise 1 + reprise 2', 'finis'])
    // Le composeur reçoit le texte DÉJÀ montré : rien de l'absence précédente n'est perdu.
    expect(precedents).toEqual(['reprise 1'])
  })

  it('deux chantiers différents gardent chacun LEUR message', () => {
    const store = new ConversationStore(() => 1000)
    const c = store.create({ title: 'deux chantiers', provider: 'claude' })
    store.noterRepriseDuChantier(c.id, 'run-a', () => 'reprise a')
    store.noterRepriseDuChantier(c.id, 'run-b', () => 'reprise b')
    store.noterRepriseDuChantier(c.id, 'run-a', (precedent) => `${precedent} (suite)`)

    expect(store.get(c.id)!.messages.map((m) => m.content)).toEqual([
      'reprise a (suite)',
      'reprise b'
    ])
  })

  it('le repère du chantier SURVIT au rechargement du disque — sinon chaque redémarrage réempilerait', () => {
    const p = join(dir, 'conversations.json')
    const avant = new ConversationStore(() => 1000)
    persistConversations(avant, p)
    const c = avant.create({ title: 'persisté', provider: 'claude' })
    avant.noterRepriseDuChantier(c.id, RUN, () => 'reprise 1')

    // Le redémarrage suivant : store neuf, relu depuis le même fichier.
    const apres = new ConversationStore(() => 2000)
    persistConversations(apres, p)
    expect(apres.noterRepriseDuChantier(c.id, RUN, (precedent) => `${precedent} + 2`)).toBe(
      'mis-a-jour'
    )
    expect(apres.get(c.id)!.messages.map((m) => m.content)).toEqual(['reprise 1 + 2'])

    // Et la mise à jour elle-même est écrite : un troisième démarrage la relit.
    const encoreApres = new ConversationStore(() => 3000)
    persistConversations(encoreApres, p)
    expect(encoreApres.get(c.id)!.messages.map((m) => m.content)).toEqual(['reprise 1 + 2'])
  })

  it('un message de reprise ANCIEN, sans repère, n’est pas adopté : on ne devine pas son chantier', () => {
    const store = new ConversationStore(() => 1000)
    const c = store.create({ title: 'ancien', provider: 'claude' })
    store.append(c.id, {
      role: 'assistant',
      content:
        "Reprise du fil — l'agent a continué de travailler pendant que l'application était fermée, et il travaille encore."
    })
    expect(store.noterRepriseDuChantier(c.id, RUN, () => 'reprise neuve')).toBe('ajoute')
    expect(store.get(c.id)!.messages).toHaveLength(2)
  })

  it('une conversation inconnue lève, comme `append`', () => {
    const store = new ConversationStore(() => 1000)
    expect(() => store.noterRepriseDuChantier('conv-absente', RUN, () => 'x')).toThrow(
      'Conversation inconnue'
    )
  })
})
