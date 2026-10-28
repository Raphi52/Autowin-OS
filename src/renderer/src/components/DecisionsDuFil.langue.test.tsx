// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'
import { ComparaisonDesFacons } from './ComparaisonDesFacons'
import { ThinkingBlock } from './ThinkingBlock'
import { appliquerLangue } from '../langue'
import type { ComparaisonDUneFacon } from '../../../shared/essai-trois-facons'

/**
 * LES DÉCISIONS DU FIL SUIVENT LA LANGUE (traduction anglaise, conv-1170, lot « Chat — décisions et
 * blocs du fil »). Entrée qui doit faire échouer ce test : un libellé de la question `ask`, de la
 * carte de comparaison des façons ou du bloc Raisonnement / Actions / Étapes laissé en dur en
 * français, un composant qui ne se redessine pas quand la langue change, ou un retour au français
 * qui ne rend pas le texte d'avant mot pour mot.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const DECISION = {
  question: 'Quel correctif appliquer ?',
  options: [
    {
      libelle: 'Les deux correctifs',
      recommande: true as const,
      detail: { fait: 'Rend le serveur silencieux.' }
    },
    { libelle: 'Ne rien changer' }
  ]
}

const LIGNES: ComparaisonDUneFacon[] = [
  {
    id: 'B1',
    ok: true,
    bilan: { etat: 'fini', vertes: 2, rouges: 0 },
    ecart: {
      ok: true,
      fichiers: [
        { chemin: 'a.ts', ajouts: 8, retraits: 2 },
        { chemin: 'b.ts', ajouts: 2, retraits: 0 }
      ],
      ajouts: 10,
      retraits: 2
    },
    ressemblance: { etat: 'mesuree', avec: 2, part: 0.4, identique: false }
  },
  {
    id: 'B2',
    ok: true,
    bilan: { etat: 'en-cours', vertes: 0, rouges: 0 },
    ecart: { ok: true, fichiers: [], ajouts: 0, retraits: 0 }
  }
]

const FACONS = [
  { id: 'B1', titre: 'Sujet — façon 1/2', rang: 1 },
  { id: 'B2', titre: 'Sujet — façon 2/2', rang: 2 }
]

const JOURNAL = [
  'Étape #1 à faire · Lire le code du bloc',
  'Étape #2 à faire · Écrire le test',
  'Étape #1 en cours · Lire le code du bloc',
  'Read · src/renderer/src/components/ThinkingBlock.tsx',
  'Read terminé - 0 s',
  'Étape #1 terminée · Lire le code du bloc'
]

let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  ;(window as unknown as { api?: unknown }).api = {
    conversationComparerLesFacons: vi.fn().mockResolvedValue(LIGNES),
    costBreakdown: vi.fn(async (_dimension: string, id: string) =>
      id === 'B1' ? [{ costUsd: 0.75, unpricedCalls: 0 }] : []
    ),
    conversationGarderEssai: vi.fn()
  }
})

afterEach(async () => {
  await act(async () => racine.unmount())
  hote.remove()
  delete (window as unknown as { api?: unknown }).api
  appliquerLangue('fr')
})

async function monterLesDecisions(): Promise<void> {
  await act(async () => {
    racine.render(
      <>
        <AskDecisionBlock decision={DECISION} onPick={() => {}} />
        {createElement(ComparaisonDesFacons, { facons: FACONS, signature: 's1' })}
        <ThinkingBlock
          text="Je relis le composant avant de toucher au test."
          done={false}
          status={JOURNAL.at(-1)!}
          statusLog={JOURNAL}
        />
      </>
    )
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise((fin) => setTimeout(fin, 0))
  })
}

const texte = (): string => hote.textContent ?? ''
const facon = (id: string): string => hote.querySelector(`[data-facon="${id}"]`)?.textContent ?? ''

describe('décisions du fil — langue', () => {
  it('bascule en anglais sans être remontées, puis reviennent au français mot pour mot', async () => {
    await monterLesDecisions()
    expect(texte()).toContain('recommandé')
    expect(texte()).toContain('ou écrivez autre chose dans le composer')
    expect(texte()).toContain('Comparer les 2 façons')
    expect(facon('B1')).toContain('2 fichiers · +10 −2')
    expect(texte()).toContain('Étapes')
    const francais = texte()

    await act(async () => appliquerLangue('en'))
    // Question `ask`
    expect(texte()).toContain('recommended')
    expect(texte()).toContain('or write something else in the composer')
    expect(texte()).toContain('on a line to answer')
    // Carte de comparaison des façons
    expect(texte()).toContain('Compare the 2 ways')
    expect(facon('B1')).toContain('Way 1')
    expect(facon('B1')).toContain('finished')
    expect(facon('B1')).toContain('2 files · +10 −2')
    expect(facon('B1')).toContain('2 green')
    expect(facon('B1')).toContain('0.75 $')
    expect(facon('B1')).toContain('Keep this one')
    expect(facon('B2')).toContain('no change')
    // Bloc Raisonnement / Actions / Étapes
    expect(texte()).toContain('Reasoning')
    expect(texte()).toContain('Steps')
    expect(texte()).not.toContain('Raisonnement')
    expect(texte()).not.toContain('Comparer les')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toBe(francais)
  })
})
