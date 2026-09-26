// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { TRANCHE_FIL, useDebutProgressif } from './fil-progressif'

/** Chaque rendu ÉCRIT (commit) note combien de messages il porte. */
function Sonde({
  cle,
  total,
  rendus,
  premiers = new Map()
}: {
  cle: string
  total: number
  rendus: number[]
  premiers?: Map<string, number>
}): null {
  const debut = useDebutProgressif(cle, total)
  useEffect(() => {
    rendus.push(total - debut)
    // Premier rendu ÉCRIT pour ce fil à cette taille : les tranches suivantes ne le masquent pas.
    if (!premiers.has(`${cle}:${total}`)) premiers.set(`${cle}:${total}`, total - debut)
  })
  return null
}

async function laisserFinir(rendus: number[], total: number): Promise<void> {
  for (let i = 0; i < 100 && rendus.at(-1) !== total; i += 1) {
    await act(async () => new Promise((fin) => setTimeout(fin, 0)))
  }
}

describe('useDebutProgressif — un long fil ne se rend jamais d’un seul bloc', () => {
  it('ouvre par la fin, puis ajoute au plus une tranche par rendu jusqu’au fil entier', async () => {
    const rendus: number[] = []
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Sonde, { cle: 'A', total: 164, rendus })))
    await laisserFinir(rendus, 164)
    expect(rendus[0]).toBe(TRANCHE_FIL)
    expect(rendus.at(-1)).toBe(164)
    for (let i = 1; i < rendus.length; i += 1) {
      expect(rendus[i] - rendus[i - 1]).toBeLessThanOrEqual(TRANCHE_FIL)
    }
    root.unmount()
  })

  it('un fil chargé d’un bloc (vide puis plein) repart de sa fin ; le streaming garde tout', async () => {
    const rendus: number[] = []
    const premiers = new Map<string, number>()
    const root = createRoot(document.createElement('div'))
    const rendre = (cle: string, total: number): Promise<void> =>
      act(async () => root.render(createElement(Sonde, { cle, total, rendus, premiers })))
    await rendre('A', 0)
    await rendre('A', 80)
    expect(premiers.get('A:80')).toBe(TRANCHE_FIL)
    await laisserFinir(rendus, 80)
    await rendre('A', 81)
    expect(premiers.get('A:81')).toBe(81)
    // Autre conversation : on repart de SA fin.
    await rendre('B', 164)
    expect(premiers.get('B:164')).toBe(TRANCHE_FIL)
    root.unmount()
  })
})
