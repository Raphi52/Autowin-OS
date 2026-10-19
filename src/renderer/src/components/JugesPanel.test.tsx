// @vitest-environment happy-dom
/**
 * BLOC DES JUGES monté sur la VRAIE trace du run jugé de conv-253 (4 passages du même juge).
 * Choix « 1 · Nacre » du /draft de conv-328 : bandeau, À corriger avec adresse et déjà-corrigé,
 * état du suivi, juges en pied qui déplient le verdict complet.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JugesPanel } from './JugesPanel'
import type { StepDeRun } from './juges-votes'
import trace from './juges-bloc.conv253.fixture.json'

async function monter(steps: readonly StepDeRun[]): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(JugesPanel, { conversationId: 'conv-253', charger: async () => steps })
    )
  })
  return host
}

const texte = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('JugesPanel — bloc Nacre', () => {
  it('un seul juge en pied, pas un par passage de réparation', async () => {
    const host = await monter(trace as StepDeRun[])
    const juges = host.querySelectorAll('[data-testid="jpan-ligne"]')
    expect(juges).toHaveLength(1)
    expect(texte(juges[0].querySelector('.jpan-juge-nom'))).toBe('claude-opus-5-5')
    expect(texte(juges[0].querySelector('.jpan-score'))).toBe('80')
  })

  it('le bandeau dit le verdict, le nombre d’objections et le suivi', async () => {
    const host = await monter(trace as StepDeRun[])
    expect(host.querySelector('[data-testid="juges-panel"]')?.getAttribute('data-verdict')).toBe(
      'defaut'
    )
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
    expect(texte(host.querySelector('.jpan-sous'))).toBe(
      '2 reprises · 1 nouvelle · 1 corrigée en partie'
    )
    expect(texte(host.querySelector('.jpan-quorum'))).toBe('0/1 valide')
  })

  it('chaque objection porte son état, son adresse, et la 1re son déjà-corrigé', async () => {
    const host = await monter(trace as StepDeRun[])
    const objections = [...host.querySelectorAll('[data-testid="jpan-objection"]')]
    expect(objections.map((o) => texte(o.querySelector('.jpan-suivi')))).toEqual([
      'REPRISE · EN PARTIE',
      'REPRISE',
      'NOUVELLE'
    ])
    expect(
      [...objections[1].querySelectorAll('[data-testid="jpan-adresses"] code')].map(texte)
    ).toEqual(['src/main/video-ffprobe.ts', 'l.11-12'])
    expect(objections[0].querySelectorAll('.jpan-corrige-ligne')).toHaveLength(2)
    expect(objections[1].querySelector('[data-testid="jpan-corrige"]')).toBeNull()
  })

  it('le verdict complet se déplie au clic sur le juge', async () => {
    const host = await monter(trace as StepDeRun[])
    expect(host.querySelector('[data-testid="jpan-verdict"]')).toBeNull()
    const juge = host.querySelector<HTMLButtonElement>('[data-testid="jpan-ligne"]')!
    await act(async () => juge.click())
    expect(juge.getAttribute('aria-expanded')).toBe('true')
    expect(texte(host.querySelector('[data-testid="jpan-verdict"]'))).toContain('SCORE: 80')
  })

  it('un long texte se replie et se déplie', async () => {
    const host = await monter(trace as StepDeRun[])
    const premiere = host.querySelector('[data-testid="jpan-objection"]')!
    expect(premiere.querySelector('.jpan-obj-texte.is-replie')).not.toBeNull()
    await act(async () => premiere.querySelector<HTMLButtonElement>('.jpan-suite')!.click())
    expect(premiere.querySelector('.jpan-obj-texte.is-replie')).toBeNull()
  })

  it('un VALIDE sans objection : bandeau vert, aucune section À corriger', async () => {
    const host = await monter([
      {
        step: 'judge',
        model: 'm',
        detail: 'vote: VALIDE',
        text: 'VALIDE\nSCORE: 92\nOBJECTIONS:\n- OK: 12 tests verts'
      }
    ])
    expect(host.querySelector('[data-testid="juges-panel"]')?.getAttribute('data-verdict')).toBe(
      'valide'
    )
    expect(texte(host.querySelector('.jpan-titre'))).toBe(
      'Aucune objection à corriger1 constat vérifié'
    )
    expect(host.querySelector('.jpan-section')).toBeNull()
  })

  it('aucun vote : rien n’est rendu', async () => {
    const host = await monter([{ step: 'exec', model: 'w', text: 'x' }])
    expect(host.querySelector('[data-testid="juges-panel"]')).toBeNull()
  })
})
