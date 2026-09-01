// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup, iconeFamille, raisonDuLien } from './ChatView.parts'

/**
 * Les 4 points du design convergé (B3-γ + L4) encore absents du FIL D'ACTIVITÉ du chat :
 * 1. pastille d'icône par FAMILLE d'outil, 2. étages en sous-lignes pointillées,
 * 3. étiquette de lien L4 (la RAISON de l'enchaînement), 4. dépliage plafonné à 180 px.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 't' }, ...over }) as Action
function render(actions: Action[]): void {
  act(() => root.render(createElement(AssistantActivityGroup, { actions })))
  // Un groupe TERMINE arrive PLIE depuis le 2026-09-01 : ces oracles portent sur le CONTENU des
  // etages, on les deplie donc comme le ferait l'utilisateur avant de les observer.
  const entete = container.querySelector<HTMLButtonElement>('[data-testid="activity-group"]')
  if (entete && entete.getAttribute('aria-expanded') === 'false') act(() => entete.click())
}
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ChatView.css'), 'utf8')
const theme = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'cosmic-outline.css'),
  'utf8'
)
const corps = (source: string, selecteur: string): string | null => {
  const i = source.indexOf(selecteur + ' {')
  if (i < 0) return null
  return source.slice(i + selecteur.length + 2, source.indexOf('}', i))
}

describe('1 — pastille d icone par famille d outil', () => {
  it('donne une icone distincte par famille', () => {
    expect(iconeFamille('edit_file')).not.toBe(iconeFamille('verify'))
    expect(iconeFamille('navigate')).not.toBe(iconeFamille('orchestrate'))
    // ENTRÉE QUI FAIT ÉCHOUER UNE FAUSSE CORRECTION : un outil inconnu ne doit pas emprunter
    // l'icône d'une famille connue (sinon la pastille MENT sur la nature de l'action).
    expect(iconeFamille('outil_inconnu_zz')).toBe('•')
    expect(iconeFamille('outil_inconnu_zz')).not.toBe(iconeFamille('edit_file'))
  })

  it('rend la pastille dans chaque sous-ligne', () => {
    render([action({ name: 'edit_file', ok: true }), action({ name: 'verify', ok: true })])
    const icones = [...container.querySelectorAll('[data-testid="activity-step-icon"]')]
    expect(icones).toHaveLength(2)
    expect(icones[0].textContent).toBe(iconeFamille('edit_file'))
    expect(icones[1].textContent).toBe(iconeFamille('verify'))
  })
})

describe('2 — etages en sous-lignes pointillees', () => {
  it('rend une sous-ligne par action quand le groupe en porte plusieurs', () => {
    render([action({ name: 'edit_file', ok: true }), action({ name: 'verify', ok: false })])
    const etages = [...container.querySelectorAll('[data-testid="activity-step"]')]
    expect(etages).toHaveLength(2)
    expect(etages[1].getAttribute('data-state')).toBe('ko')
    expect(etages[0].getAttribute('data-state')).toBe('ok')
  })

  it('la feuille relie les etages par un trait POINTILLE', () => {
    expect(corps(css, '.activity-steps')).toMatch(/border-left:[^;]*dashed/)
  })
})

describe('3 — etiquette de lien L4', () => {
  it('nomme la raison de l enchainement, et se tait sans regle', () => {
    expect(raisonDuLien(action({ name: 'edit_file', ok: false }), action({ name: 'edit_file' }))).toBe(
      '2ᵉ TENTATIVE'
    )
    expect(raisonDuLien(action({ name: 'edit_file', ok: false }), action({ name: 'verify' }))).toBe(
      'REPRISE APRÈS ÉCHEC'
    )
    expect(raisonDuLien(action({ name: 'edit_file', ok: true }), action({ name: 'verify' }))).toBe(
      'VÉRIFICATION'
    )
    // ENTRÉE QUI FAIT ÉCHOUER UNE FAUSSE CORRECTION : deux actions sans relation ne doivent
    // recevoir AUCUNE étiquette — une étiquette constante inventerait une causalité.
    expect(raisonDuLien(action({ name: 'navigate', ok: true }), action({ name: 'get_state' }))).toBeUndefined()
    expect(raisonDuLien(undefined, action({ name: 'verify' }))).toBeUndefined()
  })

  it('affiche l etiquette entre les etages concernes', () => {
    render([action({ name: 'edit_file', ok: true }), action({ name: 'verify', ok: true })])
    const liens = [...container.querySelectorAll('[data-testid="activity-step-link"]')]
    expect(liens.map((l) => l.textContent)).toEqual(['VÉRIFICATION'])
  })
})

describe('4 — depliage plafonne a 180 px', () => {
  it('plafonne le pourquoi deplie et les etages, feuille ET theme', () => {
    for (const [source, prefixe] of [
      [css, ''],
      [theme, '.cosmic-outline ']
    ] as const) {
      for (const cible of ['.activity-why', '.activity-steps']) {
        const regle = corps(source, prefixe + cible)
        expect(regle, 'regle manquante : ' + prefixe + cible).not.toBeNull()
        expect(regle!, prefixe + cible).toMatch(/max-height:\s*180px/)
        expect(regle!, prefixe + cible).toMatch(/overflow[^;]*auto/)
      }
    }
  })
})
