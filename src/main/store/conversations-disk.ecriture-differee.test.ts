import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from './conversations'
import {
  attendreEcrituresConversations,
  loadConversations,
  persistConversations
} from './conversations-disk'

/**
 * conv-717, point 4 — conversations.json s'écrit PEU APRÈS chaque changement, et à la fermeture.
 * Cas limites : rafale, fermeture pendant l'attente, fichier verrouillé à la fermeture.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-convs-differe-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.useRealTimers())

function tourEnCours(p: string) {
  const store = new ConversationStore(() => 1000)
  const flush = persistConversations(store, p)
  const c = store.create({ title: 'T', provider: 'codex' })
  store.beginTurn(c.id, { content: 'Go' }, { turnId: 't' })
  return { store, flush, id: c.id }
}

describe('écriture différée de conversations.json', () => {
  it('rafale : 50 changements rapprochés donnent UNE écriture, avec le dernier état', async () => {
    vi.useFakeTimers()
    const p = join(dir, 'rafale.json')
    const { store, id } = tourEnCours(p)
    const avant = readFileSync(p, 'utf8')
    for (let i = 0; i < 50; i += 1) {
      store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: `${i},` })
      vi.advanceTimersByTime(1) // la rafale reste sous le délai
    }
    expect(readFileSync(p, 'utf8')).toBe(avant)
    vi.advanceTimersByTime(150)
    await attendreEcrituresConversations()
    expect(loadConversations(p)[0].messages.at(-1)?.content).toContain('49,')
  })

  it('fermeture pendant l’attente : le changement est écrit, et le délai ne réécrit rien ensuite', async () => {
    vi.useFakeTimers()
    const p = join(dir, 'fermeture.json')
    const { store, flush, id } = tourEnCours(p)
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'dernier-mot' })
    flush()
    const apresFermeture = readFileSync(p, 'utf8')
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('dernier-mot')
    vi.advanceTimersByTime(500)
    await attendreEcrituresConversations()
    expect(readFileSync(p, 'utf8')).toBe(apresFermeture)
  })

  it('fichier verrouillé à la fermeture : la fermeture ne plante pas et le changement survit', () => {
    vi.useFakeTimers()
    const p = join(dir, 'verrouille.json')
    const { store, flush, id } = tourEnCours(p)
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'sauve-malgre-tout' })
    // Un dossier à la place du fichier temporaire : l'écriture complète est refusée, comme un
    // fichier tenu par un autre processus (renommage refusé).
    mkdirSync(`${p}.tmp`)
    expect(() => flush()).not.toThrow()
    rmSync(`${p}.tmp`, { recursive: true, force: true })
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('sauve-malgre-tout')
  })
})
