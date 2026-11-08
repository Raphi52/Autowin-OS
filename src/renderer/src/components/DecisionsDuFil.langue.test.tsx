// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AskDecisionBlock } from './AskDecision'
import { ThinkingBlock } from './ThinkingBlock'
import { appliquerLangue } from '../langue'

/**
 * LES DÉCISIONS DU FIL SUIVENT LA LANGUE (traduction anglaise, lot « Chat — décisions et
 * blocs du fil »). Entrée qui doit faire échouer ce test : un libellé de la question `ask` ou du
 * bloc Raisonnement / Actions / Étapes laissé en dur en français, un composant qui ne se redessine pas quand la langue change, ou un retour au français
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
})

afterEach(async () => {
  await act(async () => racine.unmount())
  hote.remove()
  appliquerLangue('fr')
})

async function monterLesDecisions(): Promise<void> {
  await act(async () => {
    racine.render(
      <>
        <AskDecisionBlock decision={DECISION} onPick={() => {}} />
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

describe('décisions du fil — langue', () => {
  it('bascule en anglais sans être remontées, puis reviennent au français mot pour mot', async () => {
    await monterLesDecisions()
    expect(texte()).toContain('recommandé')
    expect(texte()).toContain('ou écrivez autre chose dans le composer')
    expect(texte()).toContain('Étapes')
    const francais = texte()

    await act(async () => appliquerLangue('en'))
    // Question `ask`
    expect(texte()).toContain('recommended')
    expect(texte()).toContain('or write something else in the composer')
    expect(texte()).toContain('on a line to answer')
    // Bloc Raisonnement / Actions / Étapes
    expect(texte()).toContain('Reasoning')
    expect(texte()).toContain('Steps')
    expect(texte()).not.toContain('Raisonnement')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toBe(francais)
  })
})
