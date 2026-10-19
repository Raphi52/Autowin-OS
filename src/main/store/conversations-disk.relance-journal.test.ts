/**
 * INCIDENT du 2026-10-05 08:04 — conv-571, conv-572 et conv-573 absentes après la relance.
 *
 * Faits relevés sur `.autowin-data/autowin-os` :
 * - snapshot `conversations.json` figé au 02/10 (démarrage précédent), conversations créées depuis
 *   présentes UNIQUEMENT dans le journal (18 / 29 / 14 lignes à 08:00, mesuré par la passe /gc) ;
 * - la relance de 08:04:51 a bien REJOUÉ ce journal : les changements de conv-570 postérieurs au
 *   snapshot (dernier à 14:57Z le 02/10) sont dans le nouveau snapshot, et le démarrage n'a affiché
 *   aucune « ligne de journal écartée » ;
 * - les fichiers annexes des trois conversations ont TOUS disparu, y compris
 *   `activity/conv-N.jsonl`, que seul le canal de suppression de l'interface
 *   (`os:conversations:remove` / `removeMany`, src/main/ipc/conversations.ts) efface.
 *
 * Ces deux tests fixent ce que fait le démarrage avec un journal présent : il NE PERD PAS les
 * conversations qui n'existent que dans le journal ; il ne fait disparaître que celles dont le
 * journal porte une suppression — exactement la signature observée.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from './conversations'
import {
  attendreEcrituresConversations,
  conversationJournalPath,
  loadConversations,
  persistConversations
} from './conversations-disk'

const dir = mkdtempSync(join(tmpdir(), 'aos-relance-journal-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Une session : un fil existant (conv-570 du snapshot) + trois fils créés par les tâches planifiées. */
async function sessionAvecFilsSeulementDansLeJournal(p: string): Promise<{
  store: ConversationStore
  quitter: () => void
  ids: string[]
  ancien: string
}> {
  // Démarrage n°1 : pose le snapshot de base avec un fil ancien.
  const amorce = new ConversationStore(() => 1000)
  persistConversations(amorce, p)
  const ancien = amorce.create({ title: 'Fil du 02/10', provider: 'claude' }).id

  // Démarrage n°2 (le processus resté vivant du 02/10 au 05/10) : snapshot réécrit, journal vide.
  let horloge = 2000
  const store = new ConversationStore(() => horloge++)
  const quitter = persistConversations(store, p)
  // La compaction de démarrage est posée hors du fil principal (conv-359) : on l'attend.
  await attendreEcrituresConversations()
  expect(existsSync(conversationJournalPath(p))).toBe(false)

  store.append(ancien, { role: 'user', content: 'suite du 02/10 après le snapshot' })
  const ids = ['Garbage collector', 'Maintenance', 'Curation Brain'].map((title, index) => {
    const c = store.create({ title, provider: 'agent-studio-default' })
    const turnId = `tour-${index}`
    store.beginTurn(c.id, { content: `/tache ${index}` }, { turnId })
    store.applyTurnEvent(c.id, turnId, { kind: 'delta', streamId: '0:0', text: `bilan ${index}` })
    store.applyTurnEvent(c.id, turnId, { kind: 'done' })
    return c.id
  })
  return { store, quitter, ids, ancien }
}

describe('relance avec journal présent (incident du 05/10 08:04)', () => {
  it('les fils qui n’existent QUE dans le journal survivent au démarrage, et le journal est replié', async () => {
    const p = join(dir, 'survie.json')
    const { quitter, ids, ancien } = await sessionAvecFilsSeulementDansLeJournal(p)
    // Avant la fermeture : le snapshot ignore les trois fils, seul le journal les porte.
    expect(existsSync(conversationJournalPath(p))).toBe(true)
    quitter() // before-quit de la relance « mise à jour appliquée »

    const relance = new ConversationStore(() => 9000)
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    persistConversations(relance, p)
    const avertissements = avertissement.mock.calls.length
    avertissement.mockRestore()

    for (const id of ids) {
      expect(relance.get(id)?.messages.at(-1)).toMatchObject({ status: 'completed' })
    }
    expect(relance.get(ancien)?.messages.at(-1)?.content).toBe('suite du 02/10 après le snapshot')
    // Le journal est replié dans le snapshot : les trois fils y sont, le journal est vide.
    await attendreEcrituresConversations()
    expect(existsSync(conversationJournalPath(p))).toBe(false)
    expect(loadConversations(p).map((c) => c.id)).toEqual(expect.arrayContaining(ids))
    expect(avertissements).toBe(0)
  })

  it('seule une SUPPRESSION journalisée les fait disparaître — en silence, comme le 05/10', async () => {
    const p = join(dir, 'suppression.json')
    const { store, quitter, ids, ancien } = await sessionAvecFilsSeulementDansLeJournal(p)
    expect(store.removeMany(ids)).toEqual(ids)
    quitter()

    const relance = new ConversationStore(() => 9000)
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    persistConversations(relance, p)
    const avertissements = avertissement.mock.calls.length
    avertissement.mockRestore()

    expect(ids.map((id) => relance.get(id))).toEqual([undefined, undefined, undefined])
    // Le fil ancien, lui, garde sa suite rejouée depuis le même journal (conv-570 le 05/10).
    expect(relance.get(ancien)?.messages.at(-1)?.content).toBe('suite du 02/10 après le snapshot')
    expect(avertissements).toBe(0)
    // Le plancher d'identifiants a tenu : un fil neuf ne réutilise pas un id supprimé.
    expect(ids).not.toContain(relance.create({ title: 'neuf', provider: 'claude' }).id)
    await attendreEcrituresConversations()
  })
})
