import { describe, expect, it } from 'vitest'
import { aggregatePromptComposition } from './prompt-composition'

describe('aggregatePromptComposition', () => {
  it('additionne un même bloc sur plusieurs appels et donne sa part', () => {
    const composition = aggregatePromptComposition([
      { system: 'x'.repeat(300), systemBlocks: [{ name: 'pilotage', chars: 300 }] },
      { system: 'x'.repeat(100), systemBlocks: [{ name: 'pilotage', chars: 100 }] }
    ])
    expect(composition.rows).toHaveLength(1)
    expect(composition.rows[0]).toMatchObject({
      name: 'pilotage',
      chars: 400,
      calls: 2,
      share: 100
    })
    expect(composition.rows[0].kcharsPerCall).toBe(0.2)
    expect(composition.calls).toBe(2)
    expect(composition.totalChars).toBe(400)
    expect(composition.exhaustive).toBe(true)
  })

  it('compte en « non attribué » les caractères du system que nul bloc ne couvre', () => {
    const composition = aggregatePromptComposition([
      { system: 'x'.repeat(1000), systemBlocks: [{ name: 'constitution', chars: 600 }] }
    ])
    const reste = composition.rows.find((row) => row.channel === 'unattributed')
    expect(reste?.chars).toBe(400)
    expect(composition.exhaustive).toBe(false)
  })

  it('ne rend jamais un reste négatif quand un bloc déclare plus que le system envoyé', () => {
    const composition = aggregatePromptComposition([
      { system: 'x'.repeat(100), systemBlocks: [{ name: 'style', chars: 900 }] }
    ])
    expect(composition.rows.every((row) => row.channel !== 'unattributed')).toBe(true)
    expect(composition.totalChars).toBe(900)
  })

  it('classe les blocs de contexte à part et trie par caractères décroissants', () => {
    const composition = aggregatePromptComposition([
      {
        system: 'x'.repeat(50),
        systemBlocks: [{ name: 'style', chars: 50 }],
        contextBlocks: [{ name: 'echangeIntraTour', chars: 500 }]
      }
    ])
    expect(composition.rows.map((row) => row.name)).toEqual(['echangeIntraTour', 'style'])
    expect(composition.rows[0].channel).toBe('context')
  })

  it('ignore les entrées illisibles sans planter ni inventer de bloc', () => {
    const composition = aggregatePromptComposition([
      {
        systemBlocks: [
          { name: 42, chars: 10 },
          { name: 'ok', chars: 'x' }
        ]
      },
      {}
    ] as never)
    expect(composition.rows).toEqual([])
    expect(composition.calls).toBe(0)
  })
})
