// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  DUREE_GLISSEMENT_MS,
  arreterGlissement,
  courseDuPanneau,
  glisserPanneau
} from './glissement-panneau'

/**
 * LE PANNEAU DE DROITE GLISSE A L'OUVERTURE ET A LA FERMETURE (conv-987, 2026-10-16 : « je veux
 * une animation d'ouverture fermeture pour le paneau de droite »).
 *
 * happy-dom n'a ni mise en page ni API d'animation : le panneau recoit ici sa largeur, et une
 * fausse `animate` qui note ses images-cles et ses options, et dont on declenche la fin.
 */
type Appel = { images: Keyframe[]; options: KeyframeAnimationOptions; animation: FausseAnimation }
class FausseAnimation extends EventTarget {
  annulee = false
  cancel(): void {
    this.annulee = true
    this.dispatchEvent(new Event('cancel'))
  }
  finir(): void {
    this.dispatchEvent(new Event('finish'))
  }
}

function chat(largeur = 300, ecart = '10px'): { panneau: HTMLElement; appels: Appel[] } {
  const layout = document.createElement('div')
  layout.className = 'chat-layout'
  layout.style.columnGap = ecart
  const panneau = document.createElement('aside')
  panneau.className = 'runs-pane'
  layout.appendChild(panneau)
  document.body.appendChild(layout)
  panneau.getBoundingClientRect = () => ({ width: largeur }) as DOMRect
  const appels: Appel[] = []
  ;(panneau as unknown as { animate: unknown }).animate = (
    images: Keyframe[],
    options: KeyframeAnimationOptions
  ) => {
    const animation = new FausseAnimation()
    appels.push({ images, options, animation })
    return animation
  }
  return { panneau, appels }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('glisserPanneau', () => {
  it('en colonne, la course est la largeur du panneau plus l ecart avec le fil ; en tiroir, sa largeur', () => {
    const { panneau } = chat(300, '10px')
    expect(courseDuPanneau(panneau)).toBe(310)
    panneau.style.position = 'absolute'
    expect(courseDuPanneau(panneau)).toBe(300)
  })

  it("a l'ouverture, il part de hors champ et rejoint sa place, en DUREE_GLISSEMENT_MS, sans rester fige", () => {
    const { panneau, appels } = chat()
    expect(glisserPanneau(panneau, 'ouverture', { depuisDehors: true })).toBe(true)
    expect(appels).toHaveLength(1)
    expect(appels[0].images).toEqual([{ marginInlineEnd: '-310px' }, { marginInlineEnd: '0px' }])
    expect(appels[0].options.duration).toBe(DUREE_GLISSEMENT_MS)
    expect(appels[0].options.fill).toBe('none')
  })

  it('a la fermeture, il sort vers la droite, reste dehors, et conclut a la fin seulement', () => {
    const { panneau, appels } = chat()
    let fermee = 0
    glisserPanneau(panneau, 'fermeture', { surFin: () => (fermee += 1) })
    expect(appels[0].images).toEqual([{ marginInlineEnd: '0px' }, { marginInlineEnd: '-310px' }])
    expect(appels[0].options.fill).toBe('forwards')
    expect(fermee).toBe(0)
    appels[0].animation.finir()
    expect(fermee).toBe(1)
  })

  it('rouvert en pleine fermeture, il repart de la ou il en est, sans conclure la fermeture', () => {
    const { panneau, appels } = chat()
    let fermee = 0
    glisserPanneau(panneau, 'fermeture', { surFin: () => (fermee += 1) })
    // A mi-course : la marge animee se lit dans le style calcule.
    panneau.style.marginInlineEnd = '-155px'
    glisserPanneau(panneau, 'ouverture')
    expect(appels[0].animation.annulee).toBe(true)
    expect(appels[1].images).toEqual([{ marginInlineEnd: '-155px' }, { marginInlineEnd: '0px' }])
    expect(appels[1].options.duration).toBe(DUREE_GLISSEMENT_MS / 2)
    // La fin differee de la fermeture remplacee ne conclut rien, et n'efface pas l'etat courant :
    // refermer ensuite vise toujours la place de repos d'origine (0), pas la marge du moment.
    appels[0].animation.finir()
    expect(fermee).toBe(0)
    panneau.style.marginInlineEnd = '-100px'
    glisserPanneau(panneau, 'fermeture')
    expect(appels[2].images).toEqual([{ marginInlineEnd: '-100px' }, { marginInlineEnd: '-310px' }])
  })

  it("sans API d'animation ou sans largeur, rien ne glisse : l'appelant conclut tout de suite", () => {
    const { panneau } = chat(0)
    expect(glisserPanneau(panneau, 'fermeture')).toBe(false)
    const nu = document.createElement('aside')
    document.body.appendChild(nu)
    nu.getBoundingClientRect = () => ({ width: 300 }) as DOMRect
    expect(glisserPanneau(nu, 'fermeture')).toBe(false)
  })

  it('arreterGlissement annule sans conclure, et oublie la place de repos', () => {
    const { panneau, appels } = chat()
    let fermee = 0
    glisserPanneau(panneau, 'fermeture', { surFin: () => (fermee += 1) })
    arreterGlissement(panneau)
    expect(appels[0].animation.annulee).toBe(true)
    appels[0].animation.finir()
    expect(fermee).toBe(0)
    // Remonte (mode strict) : il repart de hors champ vers sa place.
    glisserPanneau(panneau, 'ouverture', { depuisDehors: true })
    expect(appels[1].images).toEqual([{ marginInlineEnd: '-310px' }, { marginInlineEnd: '0px' }])
  })
})
