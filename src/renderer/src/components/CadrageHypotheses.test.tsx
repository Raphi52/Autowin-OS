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
  { affirmation: 'le sanitizeur refuse les contrôles du modèle', source: 'confiance' },
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

  it('se masque à la demande, et seulement si on lui donne le moyen', () => {
    const masquer = vi.fn()
    rendre({ onMasquer: masquer })
    act(() => hote.querySelector<HTMLButtonElement>('.cadrage-hyp-masquer')!.click())
    expect(masquer).toHaveBeenCalledTimes(1)
    rendre()
    expect(hote.querySelector('.cadrage-hyp-masquer')).toBeNull()
  })

  it('déplie et replie le détail', () => {
    rendre()
    const triangle = hote.querySelectorAll<HTMLButtonElement>('.askd-tri')[0]
    expect(triangle.getAttribute('aria-expanded')).toBe('false')
    act(() => triangle.click())
    expect(triangle.getAttribute('aria-expanded')).toBe('true')
    expect(hote.textContent).toContain('Si c’est faux')
  })
})

describe('amorceDeCorrection', () => {
  it('nomme la supposition et laisse la phrase à finir', () => {
    const amorce = amorceDeCorrection(hypotheses[0])
    expect(amorce).toContain('« le sanitizeur refuse les contrôles du modèle »')
    expect(amorce).toMatch(/En réalité\s*:\s*$/u)
  })
})
