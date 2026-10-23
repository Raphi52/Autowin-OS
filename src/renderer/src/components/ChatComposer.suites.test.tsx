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
 * clic qui remplit le champ comme Tab — et qui, depuis conv-1103, COCHE la suite pour en combiner
 * plusieurs. Depuis conv-1087 (2026-10-22), une alternative notée sous
 * `NOTE_MIN_ALTERNATIVE` n'a plus de bouton : l'utilisateur veut choisir entre des suites
 * PERTINENTES, pas lire des à-côtés.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const FIN_DE_REPONSE = [
  '👉 Recommandé — corriger le libellé',
  'AUTOWIN_PROMPT_V1: [70] Relance la suite de tests du composer.',
  'AUTOWIN_PROMPT_V1: [90] Corrige le libellé du bouton Envoyer.',
  'AUTOWIN_PROMPT_V1: [30] Ajoute une fermeture automatique à la carte de fin de tour.',
  'AUTOWIN_PROMPT_V1: [65] Capture la vue chat pour vérifier.'
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
  it('montre les trois suites pertinentes, la mieux notée en premier, sans l’à-côté', async () => {
    const h = await monter(proprietes())
    const liste = boutons(h)
    expect(liste.map((b) => b.querySelector('.composer-suite-texte')?.textContent)).toEqual([
      'Corrige le libellé du bouton Envoyer.',
      'Relance la suite de tests du composer.',
      'Capture la vue chat pour vérifier.'
    ])
    expect(liste.map((b) => b.querySelector('.composer-suite-score')?.textContent)).toEqual([
      '90',
      '70',
      '65'
    ])
    expect(liste[0].className).toContain('is-best')
    expect(liste[1].className).not.toContain('is-best')
  })

  it('un clic coche la suite et remplit le champ et le brouillon, comme Tab', async () => {
    const brouillons: string[] = []
    const h = await monter(proprietes({ onDraftInput: (v) => brouillons.push(v) }))
    await act(async () => {
      boutons(h)[1].click()
    })
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe('Relance la suite de tests du composer.')
    expect(brouillons.at(-1)).toBe('Relance la suite de tests du composer.')
    // Les boutons RESTENT pour en cocher d'autres (conv-1103), la cochée marquée comme telle.
    expect(boutons(h).map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false'
    ])
  })

  /*
   * COCHER PLUSIEURS SUITES (conv-1103, 2026-10-22) : « je veux pouvoir cocher plusieurs
   * propositions ». Le champ devient la liste numérotée des suites cochées, dans l'ordre affiché
   * (de la mieux notée à la moins bien notée), quel que soit l'ordre des clics.
   */
  it('cocher deux suites met les deux dans le champ, en liste numérotée', async () => {
    const brouillons: string[] = []
    const h = await monter(proprietes({ onDraftInput: (v) => brouillons.push(v) }))
    await act(async () => {
      boutons(h)[2].click()
    })
    await act(async () => {
      boutons(h)[0].click()
    })
    const attendu =
      '1. Corrige le libellé du bouton Envoyer.\n2. Capture la vue chat pour vérifier.'
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe(attendu)
    expect(brouillons.at(-1)).toBe(attendu)
    expect(boutons(h).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
  })

  it('décocher retire la suite ; décocher la dernière vide le champ', async () => {
    const h = await monter(proprietes())
    await act(async () => {
      boutons(h)[0].click()
    })
    await act(async () => {
      boutons(h)[1].click()
    })
    await act(async () => {
      boutons(h)[0].click()
    })
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe('Relance la suite de tests du composer.')
    await act(async () => {
      boutons(h)[1].click()
    })
    expect(champ.value).toBe('')
    expect(boutons(h).map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false'
    ])
  })

  it('retoucher le texte efface les boutons ; vider le champ les rend sans case cochée', async () => {
    const h = await monter(proprietes())
    await act(async () => {
      boutons(h)[0].click()
    })
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    const taper = async (valeur: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          champ,
          valeur
        )
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    // Le texte n'est plus la composition des cases : c'est un message à soi, on n'y touche plus.
    await taper('Corrige le libellé du bouton Envoyer, et le titre aussi.')
    expect(boutons(h)).toHaveLength(0)
    await taper('')
    expect(boutons(h).map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false'
    ])
  })

  it('Tab prend toujours la mieux notée', async () => {
    const h = await monter(proprietes())
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(champ.value).toBe('Corrige le libellé du bouton Envoyer.')
  })

  /*
   * MAJ+TAB PREND TOUTES LES SUITES (conv-1125, 2026-10-23 : « shift + tab pour les 2 et tab le
   * premier »). Même champ que si on cochait chaque bouton : la liste numérotée, dans l'ordre
   * affiché, toutes les cases cochées pour pouvoir en retirer une au clic.
   */
  it('Maj+Tab met toutes les suites affichées dans le champ, toutes cochées', async () => {
    const brouillons: string[] = []
    const h = await monter(proprietes({ onDraftInput: (v) => brouillons.push(v) }))
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      champ.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      )
    })
    const attendu = [
      '1. Corrige le libellé du bouton Envoyer.',
      '2. Relance la suite de tests du composer.',
      '3. Capture la vue chat pour vérifier.'
    ].join('\n')
    expect(champ.value).toBe(attendu)
    expect(brouillons.at(-1)).toBe(attendu)
    expect(boutons(h).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
  })

  it('Maj+Tab sans bouton de suite reprend le texte grisé, comme Tab', async () => {
    const h = await monter(proprietes({ propositionsSuite: [] }))
    const champ = h.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      champ.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      )
    })
    expect(champ.value).toBe('Corrige le libellé du bouton Envoyer.')
  })

  it('aucun bouton pendant un tour en cours : le champ sert alors à orienter l’agent', async () => {
    const h = await monter(proprietes({ placeholderPendantTour: true }))
    expect(boutons(h)).toHaveLength(0)
  })

  // Titre demandé par l'utilisateur (conv-1103, 2026-10-22) : « le titre de cette popup c'est :
  // pour continuer... ». Il nomme aussi le groupe pour un lecteur d'écran.
  it('le bloc des suites porte le titre « Pour continuer… »', async () => {
    const h = await monter(proprietes())
    const bloc = h.querySelector('[data-testid="composer-suites"]') as HTMLElement
    expect(bloc.querySelector('.composer-suites-titre')?.textContent).toBe('Pour continuer…')
    expect(bloc.getAttribute('aria-label')).toBe('Pour continuer…')
    // Le titre n'est pas un bouton : il ne compte pas parmi les suites.
    expect(boutons(h)).toHaveLength(3)
  })

  it('aucun bouton sans suite émise — le texte grisé seul, comme avant', async () => {
    const h = await monter(proprietes({ propositionsSuite: [] }))
    expect(h.querySelector('[data-testid="composer-suites"]')).toBeNull()
  })
})
