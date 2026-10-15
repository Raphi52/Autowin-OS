import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from '../src/main/store/conversations'
import {
  attendreEcrituresConversations,
  persistConversations
} from '../src/main/store/conversations-disk'
import { idsArchives, texteDuMessage } from './conversations-sur-disque.mjs'
import { chantiersOuverts, lireCorpus } from './pilote-prompts.mjs'

/**
 * Les scripts qui lisent `conversations.json` à la main voient-ils ce que l'app y a RÉELLEMENT
 * écrit ? Le disque est produit par la vraie persistance (texte à plat vidé, fils inactifs
 * archivés), puis relu par les scripts : aucune fixture écrite à la main ne peut mentir sur le format.
 */
const racine = mkdtempSync(join(tmpdir(), 'aos-scripts-disque-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = Date.parse('2026-10-14T12:00:00.000Z')
const CLOTURE =
  'Réponse.\n⏳ Reste à faire\n- relire le module X\n👉 Recommandé\n- lancer les tests'

describe('lecture hors app du format disque des conversations', () => {
  it('rend le texte des réponses et les fils archivés, comme l’app les verrait', async () => {
    const dossier = join(racine, 'autowin-os')
    const fichier = join(dossier, 'conversations.json')
    let horloge = MAINTENANT - 30 * JOUR
    const store = new ConversationStore(() => horloge)
    const persistance = persistConversations(store, fichier)
    const vieux = store.create({ title: 'Ancien chantier', provider: 'claude' }).id
    store.beginTurn(vieux, { content: 'Fais le module' }, { turnId: 'turn-1' })
    store.applyTurnEvent(vieux, 'turn-1', { kind: 'delta', streamId: '0:0', text: CLOTURE })
    store.applyTurnEvent(vieux, 'turn-1', { kind: 'done' })
    horloge = MAINTENANT - JOUR
    const recent = store.create({ title: 'Récent', provider: 'claude' }).id
    store.append(recent, { role: 'user', content: 'Bonjour' })
    expect(await persistance.archiver(MAINTENANT)).toBe(1)
    await attendreEcrituresConversations()

    expect(idsArchives(fichier)).toEqual([vieux])
    const { conversations } = lireCorpus(dossier)
    expect(conversations.map((c) => c.id).sort()).toEqual([vieux, recent].sort())
    const ancien = conversations.find((c) => c.id === vieux)
    const reponse = ancien.messages.find((m) => m.role === 'assistant')
    // Sur le disque, son `content` est vide : le script le reconstruit à l'identique.
    expect(reponse.content).toBe('')
    expect(texteDuMessage(reponse)).toBe(store.get(vieux).messages[1].content)
    expect(chantiersOuverts(ancien).length).toBeGreaterThan(0)
  })
})
