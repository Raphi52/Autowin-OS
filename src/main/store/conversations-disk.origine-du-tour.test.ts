import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { etatDeRepriseDuFil } from '../chat/reprise-fil-apres-quota'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'

/**
 * L'ORIGINE D'UN TOUR SURVIT AU REDÉMARRAGE (conv-1423, 2026-11-01). Une reprise après quota se décide
 * souvent après une relance de l'app. Si la marque se perdait au disque, tous les fils coupés
 * passeraient à « à relancer à la main » sans rien dire ; si elle se perdait à la fin du tour, ce
 * serait le cas de toutes les coupures. Ici : vrai stockage, vrai journal, vrai rejeu.
 *
 * fix-ok: une branche relue après redémarrage sortait `{ etat: 'attente', reprendA: 3720000 }`, parce
 * que rien ne lisait `turnConversationId` ; le test de la branche ci-dessous était rouge sur ce résultat.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-origine-du-tour-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const RUNTIME = { provider: 'claude', model: 'opus', ouvertDepuisLeChat: true as const }

describe('le tour garde son origine', () => {
  it('à travers les événements du tour, y compris la session posée en fin de tour', () => {
    const store = new ConversationStore(() => 1000)
    const { id } = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(id, { content: 'Go' }, { turnId: 't', runtime: RUNTIME })
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'en cours' })
    store.applyTurnEvent(id, 't', { kind: 'failed', error: 'session limit · resets 2am' })
    expect(store.messagesOf(id).at(-1)?.runtime?.ouvertDepuisLeChat).toBe(true)

    store.beginTurn(id, { content: 'Encore' }, { turnId: 'u', runtime: RUNTIME })
    store.applyTurnEvent(id, 'u', { kind: 'done', sessionId: 'session-1' })
    expect(store.messagesOf(id).at(-1)?.runtime).toMatchObject({
      sessionId: 'session-1',
      ouvertDepuisLeChat: true
    })
  })

  it('à travers le journal, et un tour sans marque reste sans marque', async () => {
    const p = join(dir, 'journal.json')
    const store = new ConversationStore(() => 2000)
    const quitter = persistConversations(store, p)
    await attendreEcrituresConversations()
    const { id } = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(id, { content: 'Go' }, { turnId: 'humain', runtime: RUNTIME })
    store.applyTurnEvent(id, 'humain', { kind: 'failed', error: 'session limit · resets 2am' })
    store.beginTurn(
      id,
      { content: 'Regle' },
      { turnId: 'regle', runtime: { provider: 'claude', model: 'opus' } }
    )
    store.applyTurnEvent(id, 'regle', { kind: 'failed', error: 'session limit · resets 2am' })
    quitter()

    const relance = new ConversationStore(() => 9000)
    persistConversations(relance, p)
    const reponses = relance.messagesOf(id).filter((message) => message.role === 'assistant')
    expect(reponses.map((message) => message.runtime?.ouvertDepuisLeChat)).toEqual([
      true,
      undefined
    ])
  })

  it('une branche reste une copie après un redémarrage : la borne vit sur le disque', async () => {
    const p = join(dir, 'branche.json')
    const store = new ConversationStore(() => 2000)
    const quitter = persistConversations(store, p)
    await attendreEcrituresConversations()
    const { id } = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(id, { content: 'Go' }, { turnId: 't', runtime: RUNTIME })
    store.applyTurnEvent(id, 't', { kind: 'failed', error: 'session limit · resets 2am' })
    const branche = store.fork(id, store.messagesOf(id).at(-1)!.messageId!)
    quitter()

    const relance = new ConversationStore(() => 9000)
    persistConversations(relance, p)
    const etat = (fil: string): unknown =>
      etatDeRepriseDuFil({
        fil: relance.get(fil)!,
        maintenant: 3000,
        planDeLots: () => false,
        runAReprendre: () => false
      })
    expect(etat(id)).toMatchObject({ etat: 'attente' })
    expect(etat(branche.id)).toEqual({ etat: 'manuelle', raison: 'branche' })
  })
})
