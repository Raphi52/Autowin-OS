// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { PerfLagPanel } from './PerfLagPanel'
import { formaterOctets } from './formater-octets'

/**
 * L'utilisateur a du POSER la question le 2026-09-11 : « est-ce qu'autowin OS accumule des Go en
 * l'utilisant ? ». Les chiffres du menage existaient deja, mais leur seul lecteur etait un
 * `console.log` de demarrage. Ces tests verrouillent le fait qu'ils sont desormais AFFICHES.
 */
const jalonsVides = {
  tours: 0,
  lignesIllisibles: 0,
  segments: [],
  suspects: [],
  disponible: false,
  source: 'C:/data/turn-timing.jsonl'
}

const inventaire = {
  racine: 'C:/data',
  octets: 3_435_973_836,
  partiel: false,
  familles: [
    { nom: 'worktrees', octets: 664_797_184, fichiers: 12_000, partiel: false },
    { nom: 'causal-trace', octets: 405_798_912, fichiers: 197, partiel: true }
  ],
  menage: [{ famille: 'causal-trace', supprimes: 441, octetsLiberes: 700_448_768, restants: 197 }]
}

async function rendre(disque: unknown): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = {
    perfTurnLatency: async () => jalonsVides,
    osDiskUsage: async () => disque
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PerfLagPanel))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  document.body.innerHTML = ''
})

describe('espace disque dans l’onglet Latence', () => {
  it('affiche le total, chaque famille et ce que le ménage a libéré', async () => {
    const container = await rendre(inventaire)
    const section = container.querySelector('[data-testid="perf-disque"]')
    expect(section?.textContent).toContain('3.2 Go')
    const lignes = [...container.querySelectorAll('[data-testid="perf-disque-famille"]')]
    expect(lignes).toHaveLength(2)
    expect(lignes[0]?.textContent).toContain('worktrees')
    expect(lignes[0]?.textContent).toContain('634 Mo')
    // Le ménage déjà fait est nommé sur la famille qu'il a purgée, avec ce qui reste à faire.
    expect(lignes[1]?.textContent).toContain('441 supprimé(s)')
    expect(lignes[1]?.textContent).toContain('reste 197')
    // Un comptage arrêté par le plafond se DIT plancher au lieu de mentir sur le total.
    expect(lignes[1]?.textContent).toContain('au moins')
    // Une famille sans passe de ménage ne s'invente pas un chiffre.
    expect(lignes[0]?.textContent).toContain('—')
  })

  it('n’affiche rien quand le canal est absent, au lieu d’un zéro rassurant', async () => {
    const container = await rendre(undefined)
    expect(container.querySelector('[data-testid="perf-disque"]')).toBeNull()
  })

  it('rend les poids dans l’unité que l’utilisateur a en tête', () => {
    expect(formaterOctets(0)).toBe('0 o')
    expect(formaterOctets(900)).toBe('900 o')
    expect(formaterOctets(2048)).toBe('2 Ko')
    expect(formaterOctets(5 * 1024 ** 2)).toBe('5 Mo')
    expect(formaterOctets(3 * 1024 ** 3)).toBe('3.0 Go')
  })
})
