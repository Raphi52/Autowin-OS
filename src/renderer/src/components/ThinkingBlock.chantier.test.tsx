// @vitest-environment happy-dom
/**
 * CARTE DU CHANTIER — un gros chantier (outil Workflow du CLI) suivi dans le fil (lot).
 * Le journal mêle, comme en vrai, les lignes de chantier écrites par
 * `claude-workflow.ts` et des actions ordinaires.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ligneDeChantier, type Chantier } from '../../../shared/chantier-du-tour'
import { ThinkingBlock } from './ThinkingBlock'

const chantier = (plus: Partial<Chantier> = {}): Chantier => ({
  id: 'wi4rmejh2',
  nom: 'audit-routes',
  statut: 'en-cours',
  phases: [
    { titre: 'Lecture', enAttente: 2, enCours: 3, finis: 4, echecs: 1 },
    { titre: 'Synthèse', enAttente: 1, enCours: 0, finis: 0, echecs: 0 }
  ],
  enAttente: 3,
  enCours: 3,
  finis: 4,
  echecs: 1,
  jetons: 1_234_567,
  gros: false,
  quota: false,
  ...plus
})

async function monter(done: boolean, statusLog: string[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(ThinkingBlock, { text: '', done, statusLog, turnId: 'tour-c' }))
  })
  return {
    host,
    demonter: async () => {
      await act(async () => root.unmount())
      host.remove()
    }
  }
}

const carte = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[data-testid="chantier-block"]')

describe('carte du chantier', () => {
  it('montre le chantier, les agents en cours, finis et en échec, et les jetons', async () => {
    const { host, demonter } = await monter(false, [
      'Bash · ls',
      'Bash terminé - 0 s',
      ligneDeChantier(chantier({ finis: 1 })),
      ligneDeChantier(chantier())
    ])
    const texte = carte(host)?.textContent ?? ''
    expect(texte).toContain('audit-routes')
    expect(texte).toContain('3 en cours')
    expect(texte).toContain('4 finis')
    expect(texte).toContain('1 en échec')
    expect(texte).toContain('3 en attente')
    expect(texte).toContain('1,2 M jetons')
    expect(host.querySelector('[data-testid="chantier-block-compte"]')?.textContent).toBe('5/11')
    await demonter()
  })

  it('détaille chaque phase, et s’ouvre tant que le chantier tourne', async () => {
    const { host, demonter } = await monter(false, [ligneDeChantier(chantier())])
    expect((carte(host) as HTMLDetailsElement).open).toBe(true)
    const phases = [...host.querySelectorAll('[data-testid="chantier-phase"]')]
    expect(phases).toHaveLength(2)
    expect(phases[0]?.textContent).toContain('Lecture')
    expect(phases[0]?.textContent).toContain('4 finis')
    expect(phases[1]?.textContent).toContain('Synthèse')
    await demonter()
  })

  it('les lignes de chantier ne sont pas des actions', async () => {
    const { host, demonter } = await monter(false, [ligneDeChantier(chantier())])
    expect(host.querySelector('[data-testid="action-block"]')).toBeNull()
    await demonter()
  })

  it('signale un très gros chantier', async () => {
    const { host, demonter } = await monter(false, [ligneDeChantier(chantier({ gros: true }))])
    expect(host.querySelector('[data-testid="chantier-gros"]')?.textContent).toContain('25 agents')
    await demonter()
  })

  it('ne signale rien pour un chantier ordinaire', async () => {
    const { host, demonter } = await monter(false, [ligneDeChantier(chantier())])
    expect(host.querySelector('[data-testid="chantier-gros"]')).toBeNull()
    expect(host.querySelector('[data-testid="chantier-quota"]')).toBeNull()
    await demonter()
  })

  it('dit le quota, même chantier fermé et tour fini', async () => {
    const { host, demonter } = await monter(true, [
      ligneDeChantier(chantier({ quota: true, statut: 'echec', enCours: 0, enAttente: 0 }))
    ])
    expect(host.querySelector('[data-testid="chantier-quota"]')?.textContent).toContain('Quota')
    await demonter()
  })

  it('un tour fini ne laisse pas une carte « en cours »', async () => {
    const { host, demonter } = await monter(true, [ligneDeChantier(chantier())])
    expect(carte(host)?.textContent).toContain('arrêté')
    expect(carte(host)?.textContent).not.toContain('3 en cours')
    await demonter()
  })

  it('aucune carte pour un tour sans chantier', async () => {
    const { host, demonter } = await monter(false, ['Read · a.ts', 'Read terminé - 0 s'])
    expect(carte(host)).toBeNull()
    await demonter()
  })
})
