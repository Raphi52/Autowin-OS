import { describe, expect, it } from 'vitest'
import { injectionInventory } from './observatory-injection-inventory'
import type { PromptCall } from './observatory-view-types'

function call(overrides: Partial<PromptCall>): PromptCall {
  return {
    id: 'call-1',
    ts: '2026-08-31T10:00:00.000Z',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    provider: 'claude',
    boundary: 'Autowin OS -> provider transport',
    limitation: '',
    messages: [],
    options: {},
    response: '',
    ...overrides
  }
}

describe('injectionInventory', () => {
  it('nomme chaque bloc système et calcule sa part du canal', () => {
    const inventory = injectionInventory(
      call({
        system: 'a'.repeat(100),
        systemBlocks: [
          { name: 'constitution', chars: 75 },
          { name: 'style', chars: 25 }
        ]
      })
    )
    expect(inventory.blocks.map((block) => [block.name, block.share])).toEqual([
      ['constitution', 75],
      ['style', 25]
    ])
    expect(inventory.blocks.every((block) => block.channel === 'system')).toBe(true)
  })

  it('compte en NON ATTRIBUÉ les caractères que nul bloc ne revendique', () => {
    const inventory = injectionInventory(
      call({ system: 'a'.repeat(100), systemBlocks: [{ name: 'constitution', chars: 60 }] })
    )
    expect(inventory.unattributedChars).toBe(40)
    expect(inventory.exhaustive).toBe(false)
  })

  it("refuse d'annoncer exhaustif un system envoyé sans aucune décomposition", () => {
    // Le cas des sites d'appel qui n'ont jamais déclaré leurs blocs : la liste vide ne doit
    // surtout pas se lire comme « rien n'a été injecté ».
    const inventory = injectionInventory(call({ system: 'a'.repeat(4_000) }))
    expect(inventory.exhaustive).toBe(false)
    expect(inventory.empty).toBe(false)
    expect(inventory.unattributedChars).toBe(4_000)
  })

  it('déclare exhaustif quand tous les caractères système sont attribués', () => {
    const inventory = injectionInventory(
      call({
        system: 'a'.repeat(30),
        systemBlocks: [
          { name: 'constitution', chars: 20 },
          { name: 'style', chars: 10 }
        ]
      })
    )
    expect(inventory.unattributedChars).toBe(0)
    expect(inventory.exhaustive).toBe(true)
  })

  it('inventorie le contexte poussé côté user sur son propre canal', () => {
    const inventory = injectionInventory(
      call({
        system: '',
        contextBlocks: [
          { name: 'brainContext', chars: 300 },
          { name: 'memoryEcho', chars: 100 }
        ]
      })
    )
    expect(inventory.blocks).toEqual([
      { name: 'brainContext', chars: 300, channel: 'context', share: 75 },
      { name: 'memoryEcho', chars: 100, channel: 'context', share: 25 }
    ])
    expect(inventory.empty).toBe(false)
  })

  it('ne rend négatif aucun reste quand un bloc dépasse le system final', () => {
    const inventory = injectionInventory(
      call({ system: 'a'.repeat(10), systemBlocks: [{ name: 'tronqué', chars: 900 }] })
    )
    expect(inventory.unattributedChars).toBe(0)
  })

  it('signale un appel sans aucune injection', () => {
    expect(injectionInventory(call({})).empty).toBe(true)
  })
})
