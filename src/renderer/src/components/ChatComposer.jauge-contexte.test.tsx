// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'

/**
 * LE FILET AU-DESSUS DU CHAMP EST LA JAUGE DE CONTEXTE (demande utilisateur conv-240, reference
 * claude.exe : « joindre l'utile a l'agreable »).
 *
 * Ce test existe parce qu'un trait d'UN PIXEL ne se prouve pas sur une capture d'ecran compressee :
 * la seule preuve lisible est la valeur reellement posee sur l'element. Il verifie les DEUX etats
 * qui comptent — occupation connue (le filet porte un remplissage et un palier) et occupation
 * INCONNUE (aucun attribut : le filet reste gris, il ne montre PAS 0 %, ce qui affirmerait a tort
 * que le fil est vide).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const proprietes = (over: Partial<ChatComposerProps> = {}): ChatComposerProps => ({
  busy: false,
  hasActiveConversation: true,
  resumeAvailable: false,
  attachmentCount: 0,
  mentionSources: { runs: [], files: [] } as never,
  skillCommands: [],
  ghostRecommendation: null,
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

function monter(props: ChatComposerProps): HTMLElement {
  const hote = document.createElement('div')
  document.body.append(hote)
  const racine = createRoot(hote)
  act(() => racine.render(<ChatComposer {...props} />))
  const filet = hote.querySelector('[data-testid="composer-context-rule"]')
  if (!(filet instanceof HTMLElement)) throw new Error('zone de saisie absente du rendu')
  return filet
}

describe('ChatComposer — le separateur porte la jauge de contexte', () => {
  it('peint le filet a la part occupee et nomme le palier', () => {
    const filet = monter(
      proprietes({ contextRatio: 0.72, contextLevel: 'tendu', contextTitle: 'Contexte : 144 000' })
    )

    expect(filet.style.getPropertyValue('--context-fill')).toBe('72%')
    expect(filet.dataset.contextLevel).toBe('tendu')
    const bulle = filet.querySelector('[data-testid="composer-context-tip"]')
    expect(bulle).not.toBeNull()
    expect((bulle as HTMLElement).title).toContain('Contexte')
    expect((bulle as HTMLElement).textContent).toContain('Contexte')
  })

  it('montre le PANNEAU de detail au survol du filet, et le retire en sortant', () => {
    /*
     Le filet ne portait qu une bulle de texte, alors que la barre de l en-tete ouvrait un panneau
     complet : deux vues de la MEME donnee repondaient differemment au meme geste (demande du
     2026-09-08). Le panneau est fabrique par le parent ; ici on prouve le GESTE, pas son contenu.
    */
    const filet = monter(
      proprietes({
        contextRatio: 0.03,
        contextLevel: 'ok',
        contextTitle: 'Contexte : 30 439',
        contextPanelNode: <p data-testid="panneau-essai">detail</p>
      })
    )
    const zone = filet.querySelector('[data-testid="composer-context-tip"]') as HTMLElement
    expect(zone.querySelector('[data-testid="panneau-essai"]')).toBeNull()

    // React derive enter/leave des evenements DELEGUES pointerover/pointerout.
    act(() => {
      zone.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    })
    expect(zone.querySelector('[data-testid="panneau-essai"]')).not.toBeNull()
    // L infobulle du navigateur s efface : le panneau dit deja tout, en double ce serait du bruit.
    expect(zone.title).toBe('')

    act(() => {
      zone.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    })
    expect(zone.querySelector('[data-testid="panneau-essai"]')).toBeNull()
  })

  it('laisse le filet GRIS quand l occupation est inconnue — jamais 0 %', () => {
    const filet = monter(proprietes({ contextRatio: undefined }))

    expect(filet.style.getPropertyValue('--context-fill')).toBe('')
    expect(filet.dataset.contextLevel).toBeUndefined()
  })

  it('borne le remplissage a 100 % : un depassement ne peint pas au-dela du filet', () => {
    const filet = monter(proprietes({ contextRatio: 1.4, contextLevel: 'critique' }))

    expect(filet.style.getPropertyValue('--context-fill')).toBe('100%')
    expect(filet.dataset.contextLevel).toBe('critique')
  })
})
