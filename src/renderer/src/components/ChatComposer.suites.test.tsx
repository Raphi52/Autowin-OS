// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'
import { extrairePropositionsSuite } from '../../../shared/prompt-suivant'

/**
 * LES TROIS SUITES NOTÉES, EN BOUTONS (conv-1005, 2026-10-16) : « choisir entre 3 préprompts scorés
 * et cliquer au lieu de faire Tab ». Le test part d'une VRAIE fin de réponse (les lignes
 * `AUTOWIN_PROMPT_V1` telles que le modèle les écrit), passe par le même lecteur que l'écran du
 * chat, et vérifie ce que l'utilisateur voit et obtient : trois boutons classés, leur note, et un
 * clic qui remplit le champ comme Tab.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const FIN_DE_REPONSE = [
  '👉 Recommandé — corriger le libellé',
  'AUTOWIN_PROMPT_V1: [55] Relance la suite de tests du composer.',
  'AUTOWIN_PROMPT_V1: [90] Corrige le libellé du bouton Envoyer.',
  'AUTOWIN_PROMPT_V1: [30] Capture la vue chat pour vérifier.'
].join('\n')

const proprietes = (over: Partial<ChatComposerProps> = {}): ChatComposerProps => ({
  busy: false,
  hasActiveConversation: true,
  resumeAvailable: false,
  attachmentCount: 0,
  mentionSources: { runs: [], files: [] } as never,
  skillCommands: [],
  ghostRecommendation: 'Corrige le libellé du bouton Envoyer.',
  propositionsSuite: extrairePropositionsSuite(FIN_DE_REPONSE, 'corrige le bouton'),
  placeholderPendantTour: false,
  onDraftInput: () => {},
  onDraftPresence: () => {},
  onBtw: () => false,
  onSend: () => {},
  onQueue: () => {},
  onResume: () => {},
  onPaste: () => {},
  ...over
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(props: ChatComposerProps): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(<ChatComposer {...props} />)
  })
  return hote
}

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  hote?.remove()
  root = null
  hote = null
})

const boutons = (h: HTMLElement): HTMLButtonElement[] => [
  ...h.querySelectorAll<HTMLButtonElement>('[data-testid="composer-suite"]')
]

describe('ChatComposer — suites notées en boutons', () => {
  it('montre les trois suites, la mieux notée en premier, avec leur note', async () => {
    const h = await monter(proprietes())
    const liste = boutons(h)
    expect(liste.map((b) => b.querySelector('.composer-suite-texte')?.textContent)).toEqual([
      'Corrige le libellé du bouton Envoyer.',
      'Relance la suite de tests du composer.',
      'Capture la vue chat pour vérifier.'
    ])
    expect(liste.map((b) => b.querySelector('.composer-suite-score')?.textContent)).toEqual([
      '90',
      '55',
      '30'
    ])
    expect(liste[0].className).toContain('is-best')
    expect(liste[1].className).not.toContain('is-best')
  })

  it('un clic remplit le champ et le brouillon, comme Tab', async () => {
    const brouillons: string[] = []
    const h = await monter(proprietes({ onDraftInput: (v) => brouillons.push(v) }))
    await act(async () => {
      boutons(h)[1].click()
    })
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe('Relance la suite de tests du composer.')
    expect(brouillons.at(-1)).toBe('Relance la suite de tests du composer.')
    // Le champ n'est plus vide : les boutons s'effacent, on écrit autre chose.
    expect(boutons(h)).toHaveLength(0)
  })

  it('Tab prend toujours la mieux notée', async () => {
    const h = await monter(proprietes())
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(champ.value).toBe('Corrige le libellé du bouton Envoyer.')
  })

  it('aucun bouton pendant un tour en cours : le champ sert alors à orienter l’agent', async () => {
    const h = await monter(proprietes({ placeholderPendantTour: true }))
    expect(boutons(h)).toHaveLength(0)
  })

  it('aucun bouton sans suite émise — le texte grisé seul, comme avant', async () => {
    const h = await monter(proprietes({ propositionsSuite: [] }))
    expect(h.querySelector('[data-testid="composer-suites"]')).toBeNull()
  })
})
