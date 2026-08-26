// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * L'EN-TÊTE NE DIT PLUS « TERMINÉE » AU-DESSUS D'UN REFUS.
 *
 * Vu par l'utilisateur le 2026-08-26 : « 1 action terminée · remember » écrit juste au-dessus de
 * l'erreur rouge « type invalide ». `failed` se calculait sur `action.ok === false` seulement, or un
 * dépôt Brain refusé est une commande qui a parfaitement RÉUSSI à rendre un refus.
 *
 * POURQUOI CE TEST EXISTE, et pas seulement celui du résumé : dans cette même session, j'ai écrit
 * trois tests qui passaient sans rien discriminer, chaque fois parce qu'ils vérifiaient la brique
 * et non son BRANCHEMENT. Le résumé savait déjà dire « refusé » ; ce qui manquait, c'est que
 * l'en-tête le lise. C'est donc l'en-tête qu'on teste ici, pas le résumé.
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

const rendre = (action: unknown): string => {
  act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] as never })))
  return container.querySelector<HTMLElement>('[data-testid="activity-group"]')?.textContent ?? ''
}

const refuse = {
  kind: 'action' as const,
  name: 'remember',
  ok: true,
  args: { title: 'Une leçon' },
  data: {
    allowed: false,
    stored: false,
    reason: "type invalide — recu « cause-racine », attendu l'un de : lesson, decision, preference, domain"
  }
}

const reussi = {
  kind: 'action' as const,
  name: 'remember',
  ok: true,
  args: { title: 'Une leçon' },
  data: { allowed: true, stored: true, detail: 'déposé au Brain (inbox)' }
}

describe('un dépôt refusé ne s’annonce pas comme terminé', () => {
  it('l’en-tête ne dit PAS « terminée »', () => {
    expect(rendre(refuse)).not.toContain('terminée')
  })

  it('l’en-tête dit que l’action est restée SANS EFFET', () => {
    expect(rendre(refuse)).toContain('sans effet')
  })

  it('un dépôt RÉUSSI reste « terminée »', () => {
    // L'autre bord : si tout devient « sans effet », l'étiquette ne distingue plus rien.
    expect(rendre(reussi)).toContain('terminée')
  })
})
