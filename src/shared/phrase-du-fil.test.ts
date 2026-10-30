import { describe, expect, it } from 'vitest'
import type { PlanDeLots } from './plan-de-lots'
import { phraseDuFil, phrasesDesLots } from './phrase-du-fil'

const reponse = (
  ...textes: string[]
): { role: string; parts: Array<{ kind: string; text?: string }> } => ({
  role: 'assistant',
  parts: textes.flatMap((text) => [{ kind: 'action' }, { kind: 'text', text }])
})

describe('phraseDuFil', () => {
  it('lot fini : la première ligne utile de sa dernière réponse, sans marqueurs ni gras', () => {
    const fil = [
      { role: 'user', parts: [] },
      reponse('**Livré** : capture lue, vitest 8/8.\n\n✅ Fait\n1. ...\nAUTOWIN_BESOIN_V1: suite')
    ]
    expect(phraseDuFil(fil, false)).toBe('Livré : capture lue, vitest 8/8.')
  })

  it('lot fini : le résultat, pas la première narration du tour (conv-1259 : 24 morceaux de texte)', () => {
    const fil = [
      reponse(
        'Je lis encore les outils de capture.',
        'Je lance les captures.',
        'J’ai fait les 21 captures, avec un manifeste.\n\n✅ Fait\n1. Captures faites.'
      )
    ]
    expect(phraseDuFil(fil, false)).toBe('J’ai fait les 21 captures, avec un manifeste.')
  })

  it('une clôture qui commence par sa rubrique donne sa première ligne de contenu', () => {
    const fil = [reponse('Je vérifie.', '✅ Fait\n1. Trois lots rangés, tests verts.')]
    expect(phraseDuFil(fil, false)).toBe('Trois lots rangés, tests verts.')
  })

  it('le bandeau de reprise d’un fil n’est pas ce que dit le lot (conv-1307)', () => {
    const fil = [
      reponse(
        'Reprise du fil — l’agent a continué de travailler.\n\nJe lis le moteur du navigateur.'
      )
    ]
    expect(phraseDuFil(fil, false)).toBe('Je lis le moteur du navigateur.')
  })

  it('lot en cours : la dernière ligne écrite, ce qu’il fait maintenant', () => {
    const fil = [reponse('Je lis le code.\nJe lis le coût de chaque fil (costBreakdown)…')]
    expect(phraseDuFil(fil, true)).toBe('Je lis le coût de chaque fil (costBreakdown)…')
  })

  it('lot en cours sans texte dans son tour : la dernière ligne du tour d’avant', () => {
    const fil = [reponse('Avant.'), { role: 'assistant', parts: [{ kind: 'action' }] }]
    expect(phraseDuFil(fil, true)).toBe('Avant.')
  })

  it('un message sans morceaux se lit par son contenu', () => {
    expect(phraseDuFil([{ role: 'assistant', content: 'Livré.\nDétail.' }], false)).toBe('Livré.')
  })

  it('rien d’écrit : undefined ; ligne trop longue : coupée', () => {
    expect(phraseDuFil([{ role: 'user', parts: [] }], false)).toBeUndefined()
    const longue = phraseDuFil([reponse('a'.repeat(400))], false)
    expect(longue?.length).toBe(160)
    expect(longue?.endsWith('…')).toBe(true)
  })
})

describe('phrasesDesLots', () => {
  const lot = (rang: number, etat: PlanDeLots['lots'][number]['etat'], fil?: string) => ({
    rang,
    titre: `Lot ${rang}`,
    demande: 'x',
    fichiers: [],
    etat,
    ...(fil ? { fil } : {})
  })
  const plan = { lots: [lot(1, 'fait', 'conv-1'), lot(2, 'en-cours', 'conv-2'), lot(3, 'a-faire')] }

  it('lit chaque fil de lot, ouvert à l’écran ou non, au bon sens de lecture', () => {
    const fils: Record<string, ReturnType<typeof reponse>[]> = {
      'conv-1': [reponse('Je lis.', 'Livré.\nDétail.')],
      'conv-2': [reponse('Je lis.\nJ’écris le test.')]
    }
    expect(phrasesDesLots(plan, (fil) => fils[fil])).toEqual({
      1: 'Livré.',
      2: 'J’écris le test.'
    })
  })

  it('un fil inconnu ou muet ne donne aucune entrée', () => {
    expect(phrasesDesLots(plan, () => undefined)).toEqual({})
    expect(phrasesDesLots(plan, () => [{ role: 'user', parts: [] }])).toEqual({})
  })
})
