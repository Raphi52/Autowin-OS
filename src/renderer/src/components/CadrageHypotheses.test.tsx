// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CadrageHypotheses } from './CadrageHypotheses'
import { amorceDeCorrection, type HypotheseDeCadrage } from '../../../shared/cadrage-confiance'

let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

const hypotheses: HypotheseDeCadrage[] = [
  {
    affirmation: 'le sanitizeur refuse les contrôles du modèle',
    source: 'confiance',
    justification: 'non exécutable en FRAME ; premier geste de BUILD'
  },
  { affirmation: 'le store est vide au premier lancement', source: 'besoin' }
]

function rendre(props: Partial<Parameters<typeof CadrageHypotheses>[0]> = {}): void {
  act(() => racine.render(<CadrageHypotheses hypotheses={hypotheses} {...props} />))
}

describe('CadrageHypotheses — les suppositions du run, contestables sans l’arrêter', () => {
  it('rend une ligne par supposition, empilée', () => {
    rendre()
    expect(hote.querySelectorAll('[data-testid="cadrage-hypothese"]')).toHaveLength(2)
    expect(hote.textContent).toContain('le sanitizeur refuse les contrôles du modèle')
  })

  it('dit d’où vient la supposition — déclarée, pas devinée', () => {
    rendre()
    expect(hote.textContent).toContain('marqué NON VÉRIFIÉ par le cadrage')
    expect(hote.textContent).toContain('hypothèse écrite dans le besoin')
  })

  it('ne rend RIEN sans supposition : pas de bloc vide qui inquiète pour rien', () => {
    act(() => racine.render(<CadrageHypotheses hypotheses={[]} />))
    expect(hote.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()
  })

  it('un clic PRÉ-REMPLIT une amorce, il n’envoie pas — dire ce qui est vrai demande une phrase', () => {
    const corriger = vi.fn()
    rendre({ onCorriger: corriger })
    act(() => hote.querySelectorAll<HTMLButtonElement>('.askd-choix')[1].click())
    expect(corriger).toHaveBeenCalledTimes(1)
    const amorce = corriger.mock.calls[0][0] as string
    expect(amorce).toContain('le store est vide au premier lancement')
    // L'amorce se termine ouverte : l'utilisateur complète, le modèle ne reçoit pas un verdict vide.
    expect(amorce.trimEnd().endsWith(':')).toBe(true)
  })

  it('le pied dit explicitement que rien n’attend l’utilisateur', () => {
    rendre()
    const pied = hote.querySelector('.askd-pied')?.textContent ?? ''
    expect(pied).toContain('Le run continue')
  })

  it('« Corriger » est le mot de l’action, jamais un raccourci clavier', () => {
    rendre()
    expect(hote.querySelector('.askd-entree')?.textContent).toBe('Corriger')
    // Aucun numéro de ligne : ce bloc ne se répond pas au chiffre, contrairement au bloc `ask`.
    expect(hote.querySelector('.askd-touche')).toBeNull()
  })

  /*
   * REPLI SUR UNE LIGNE — demande du 19/10 (conv-358) : « ce bloc je veux pouvoir le réduire à une
   * ligne, remplace la croix par une flèche down up ». La croix FAISAIT DISPARAÎTRE le bloc ; la
   * flèche le replie sur sa ligne de titre et le rouvre : les suppositions restent à portée.
   */
  it('une flèche replie le bloc sur sa ligne de titre, et le rouvre', () => {
    rendre()
    const fleche = hote.querySelector<HTMLButtonElement>('.cadrage-hyp-plier')!
    expect(hote.textContent).not.toContain('×')
    expect(fleche.getAttribute('aria-expanded')).toBe('true')
    expect(hote.querySelectorAll('[data-testid="cadrage-hypothese"]')).toHaveLength(2)

    act(() => fleche.click())
    expect(fleche.getAttribute('aria-expanded')).toBe('false')
    expect(hote.querySelector('[data-testid="cadrage-hypotheses"]')!.classList).toContain(
      'is-replie'
    )
    expect(hote.querySelector('.askd-liste')).toBeNull()
    expect(hote.querySelector('.askd-pied')).toBeNull()
    // Replié, la ligne dit encore COMBIEN de suppositions attendent : rien n'a disparu.
    expect(hote.querySelector('.cadrage-hyp-compte')?.textContent).toBe('2 suppositions')

    act(() => fleche.click())
    expect(fleche.getAttribute('aria-expanded')).toBe('true')
    expect(hote.querySelectorAll('[data-testid="cadrage-hypothese"]')).toHaveLength(2)
  })

  it('déplie sur la RAISON du cadrage, pas sur une phrase toute faite', () => {
    rendre()
    const triangle = hote.querySelector<HTMLButtonElement>('.askd-tri[aria-expanded]')!
    expect(triangle.getAttribute('aria-expanded')).toBe('false')
    act(() => triangle.click())
    expect(triangle.getAttribute('aria-expanded')).toBe('true')
    expect(hote.textContent).toContain('Pourquoi')
    expect(hote.textContent).toContain('non exécutable en FRAME ; premier geste de BUILD')
  })

  it('sans raison à montrer, aucun triangle : un dépliable vide est un piège', () => {
    rendre()
    // Deux lignes, une seule justification → un seul triangle actionnable.
    expect(hote.querySelectorAll('.askd-tri[aria-expanded]')).toHaveLength(1)
    expect(hote.querySelectorAll('.askd-tri[aria-hidden="true"]')).toHaveLength(1)
  })
})

describe('amorceDeCorrection', () => {
  it('nomme la supposition et laisse la phrase à finir', () => {
    const amorce = amorceDeCorrection(hypotheses[0])
    expect(amorce).toContain('« le sanitizeur refuse les contrôles du modèle »')
    expect(amorce).toMatch(/En réalité\s*:\s*$/u)
  })
})
