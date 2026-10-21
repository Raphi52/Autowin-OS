// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * « SKILL CHARGÉE » DANS LE FIL (conv-1034, 2026-10-21).
 *
 * Le modèle peut choisir une skill seul (`skill_charger`). Mesuré dans une instance cachée : la
 * carte d'action du fil affichait le nom brut « skill_charger », parce que son libellé vient de
 * `CMD_LABEL` (ChatView.parts.tsx) et non de la table du graphe d'exécution
 * (execution-step-titles.ts), seule à avoir reçu « Skill chargée ».
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

const skillChargee = {
  kind: 'action' as const,
  name: 'skill_charger',
  ok: true,
  args: { nom: 'look' },
  data: { skill: 'look', procedure: '=== SKILL LOOK (kit) ===' }
}

describe('la carte du fil nomme une skill chargée par le modèle', () => {
  it('affiche « Skill chargée », jamais le nom brut de la commande', () => {
    act(() =>
      root.render(createElement(AssistantActivityGroup, { actions: [skillChargee] as never }))
    )
    const texte = container.textContent ?? ''
    expect(texte).toContain('Skill chargée')
    expect(texte).not.toContain('skill_charger')
  })
})
