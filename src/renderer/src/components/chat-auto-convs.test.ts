import { describe, expect, it } from 'vitest'
import {
  CLE_MODE_AUTO_CONVS,
  EVT_ARMER_MODE_AUTO,
  armerModeAutoConversation,
  lireConvsAuto
} from './chat-auto-convs'

function stockage(initial?: string) {
  const m = new Map<string, string>()
  if (initial !== undefined) m.set(CLE_MODE_AUTO_CONVS, initial)
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('fil ouvert par le mode auto Tickets = fil arme en mode auto', () => {
  it('ajoute la conversation sans toucher aux autres, et previent le chat', () => {
    const s = stockage(JSON.stringify(['conv-1']))
    const recus: unknown[] = []
    const cible = new EventTarget()
    cible.addEventListener(EVT_ARMER_MODE_AUTO, (e) => recus.push((e as CustomEvent).detail))
    armerModeAutoConversation('conv-2', s, cible)
    expect([...lireConvsAuto(s)]).toEqual(['conv-1', 'conv-2'])
    expect(recus).toEqual(['conv-2'])
  })

  it('un stockage illisible repart a vide sans planter', () => {
    const s = stockage('{pas du json')
    armerModeAutoConversation('conv-9', s, null)
    expect([...lireConvsAuto(s)]).toEqual(['conv-9'])
  })
})
