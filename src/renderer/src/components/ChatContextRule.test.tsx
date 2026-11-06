// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { ChatContextRule } from './ChatContextRule'

/**
 * LA JAUGE DE CONTEXTE EST LE SEPARATEUR ENTRE L'EN-TETE DU CHAT ET LE FIL (2026-10-10 :
 * « la barre de contexte met-la en haut comme separateur entre le header du chat et le chat »).
 * Elle vivait sur le filet au-dessus du champ de saisie ; ses gestes restent.
 *
 * Ce test existe parce qu'un trait de deux pixels ne se prouve pas sur une capture compressee : la
 * seule preuve lisible est la valeur reellement posee sur l'element. Il verifie les DEUX etats qui
 * comptent -- occupation connue (remplissage + palier) et occupation INCONNUE (rien n'est rendu : le
 * filet reste gris, il ne montre PAS 0 %, ce qui affirmerait a tort que le fil est vide).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

function monter(element: React.JSX.Element): HTMLElement {
  const hote = document.createElement('div')
  document.body.append(hote)
  const racine = createRoot(hote)
  act(() => racine.render(element))
  return hote
}
const jauge = (hote: HTMLElement): HTMLElement => {
  const filet = hote.querySelector('[data-testid="chat-context-rule"]')
  if (!(filet instanceof HTMLElement)) throw new Error('jauge de contexte absente du rendu')
  return filet
}

describe('ChatContextRule — la jauge de contexte sous l en-tete', () => {
  it('peint le filet a la part occupee et nomme le palier', () => {
    const filet = jauge(monter(<ChatContextRule ratio={0.72} level="tendu" title="Contexte : 144 000" />))

    expect(filet.style.getPropertyValue('--context-fill')).toBe('72%')
    expect(filet.dataset.contextLevel).toBe('tendu')
    expect(filet.title).toContain('Contexte')
    expect(filet.textContent).toContain('Contexte')
  })

  it('ecrit le mot « contexte » au bout du remplissage, meme sans panneau ouvert', () => {
    // « qu'il y ait ecrit contexte au bout de la jauge ». Sa position vient du CSS
    // (ChatContextRule.style.test.ts) ; ici on prouve qu'il est rendu, sans attendre le survol.
    const filet = jauge(monter(<ChatContextRule ratio={0.4} level="ok" panelNode={<p>detail</p>} />))
    const libelle = filet.querySelector('.chat-context-rule-libelle')
    expect(libelle?.textContent?.trim()).toBe('contexte')
  })

  it('montre le PANNEAU de detail au survol du filet, et le retire en sortant', () => {
    /*
     Le filet ne portait qu une bulle de texte, alors que la barre de l en-tete ouvrait un panneau
     complet : deux vues de la MEME donnee repondaient differemment au meme geste (demande du
     2026-09-08). Le panneau est fabrique par le parent ; ici on prouve le GESTE, pas son contenu.
    */
    const filet = jauge(
      monter(
        <ChatContextRule
          ratio={0.03}
          level="ok"
          title="Contexte : 30 439"
          panelNode={<p data-testid="panneau-essai">detail</p>}
        />
      )
    )
    expect(filet.querySelector('[data-testid="panneau-essai"]')).toBeNull()

    // React derive enter/leave des evenements DELEGUES pointerover/pointerout.
    act(() => {
      filet.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    })
    expect(filet.querySelector('[data-testid="panneau-essai"]')).not.toBeNull()
    // L infobulle du navigateur s efface : le panneau dit deja tout, en double ce serait du bruit.
    expect(filet.title).toBe('')

    act(() => {
      filet.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    })
    expect(filet.querySelector('[data-testid="panneau-essai"]')).toBeNull()
  })

  it('garde le panneau OUVERT apres un clic, pour pouvoir viser Compacter', () => {
    /*
     Signale le 2026-09-08 : « je peux pas cliquer sur Compacter car la popup disparait des que je
     sors du hover ». Un bouton dans un panneau qui se ferme quand on le quitte est inatteignable.
    */
    const filet = jauge(
      monter(
        <ChatContextRule
          ratio={0.03}
          level="ok"
          title="Contexte : 30 439"
          panelNode={<p data-testid="panneau-essai">detail</p>}
        />
      )
    )
    act(() => {
      filet.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      filet.click()
    })
    // La souris s en va : le panneau doit RESTER, sinon le bouton n est jamais atteignable.
    act(() => {
      filet.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    })
    expect(filet.querySelector('[data-testid="panneau-essai"]')).not.toBeNull()

    // Un clic AILLEURS le referme.
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(filet.querySelector('[data-testid="panneau-essai"]')).toBeNull()
  })

  it('ne rend RIEN quand l occupation est inconnue -- jamais 0 %', () => {
    const hote = monter(<ChatContextRule ratio={undefined} title="Contexte" />)

    expect(hote.querySelector('[data-testid="chat-context-rule"]')).toBeNull()
  })

  it('prend la largeur de la jauge des quotas, en bas du chat', () => {
    /*
     2026-10-31 : « la barre de contexte en haut faut la mettre de la meme largeur que
     celle d'en bas (donc moins large) ». Les marges de la jauge du bas viennent du theme : la jauge
     du haut MESURE ses bords. En-tete 1000 px a partir de 100 ; jauge du bas de 132 a 1068.
    */
    const rect = (left: number, right: number) => (): DOMRect =>
      ({
        left,
        right,
        width: right - left,
        top: 0,
        bottom: 10,
        height: 10,
        x: left,
        y: 0
      }) as DOMRect
    const chat = document.createElement('section')
    chat.className = 'chat'
    const entete = document.createElement('header')
    entete.className = 'chat-head'
    entete.style.position = 'relative'
    entete.getBoundingClientRect = rect(100, 1100)
    const rangee = document.createElement('div')
    rangee.className = 'composer-input-row'
    const quota = document.createElement('div')
    quota.className = 'model-quota'
    quota.getBoundingClientRect = rect(132, 1068)
    rangee.append(quota)
    chat.append(entete, rangee)
    document.body.append(chat)
    act(() => createRoot(entete).render(<ChatContextRule ratio={0.5} level="ok" />))
    const filet = jauge(entete)

    expect(filet.style.left).toBe('32px')
    expect(filet.style.right).toBe('32px')
  })

  it('garde la pleine largeur quand la jauge des quotas est absente', () => {
    const filet = jauge(monter(<ChatContextRule ratio={0.5} level="ok" />))

    expect(filet.style.left).toBe('')
    expect(filet.style.right).toBe('')
  })

  it('borne le remplissage a 100 % : un depassement ne peint pas au-dela du filet', () => {
    const filet = jauge(monter(<ChatContextRule ratio={1.4} level="critique" />))

    expect(filet.style.getPropertyValue('--context-fill')).toBe('100%')
    expect(filet.dataset.contextLevel).toBe('critique')
  })
})
