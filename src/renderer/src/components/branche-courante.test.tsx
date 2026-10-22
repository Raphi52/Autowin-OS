// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrancheCourante } from './branche-courante'

/**
 * DEFAUT MESURE le 2026-08-30 : le badge affichait `main` alors que le depot etait sur
 * `chore/route-confidence-threshold-097`. La lecture ne se faisait qu'au montage de la vue.
 */
const PERIODE_MS = 50

function Sonde({ lire }: { lire: () => Promise<unknown> }): ReactElement {
  const branche = useBrancheCourante(lire as never, PERIODE_MS)
  return createElement('span', { 'data-test': 'branche' }, branche ?? '')
}

/** Chaque montage garde sa racine et le nombre de lectures faites, pour le contrôle d'après-test. */
const montes: Array<{ root: Root; lectures: () => number }> = []

async function monter(lire: () => Promise<unknown>): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let lectures = 0
  const lireCompte = (): Promise<unknown> => {
    lectures += 1
    return lire()
  }
  montes.push({ root, lectures: () => lectures })
  await act(async () => {
    root.render(createElement(Sonde, { lire: lireCompte }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

/*
 * AUCUNE RELECTURE NE SURVIT À SON TEST — mesuré le 2026-10-22 (conv-1056).
 *
 * Les quatre tests montaient la sonde sans jamais la démonter : chaque montage laissait son
 * battement de 50 ms tourner après la fin du fichier. Dans la suite complète (1959 fichiers,
 * poste chargé), un battement est tombé APRÈS la fermeture de happy-dom ; la lecture en échec du
 * dernier test a appelé `setBranche` et React a levé `ReferenceError: window is not defined`
 * (branche-courante.ts:36). Vitest l'a compté en « Unhandled Rejection » : 16 763 tests verts,
 * code de sortie 1. Le hook nettoie bien au démontage — c'est le test qui ne démontait pas.
 */
afterEach(async () => {
  vi.useRealTimers()
  await act(async () => {
    for (const m of montes) m.root.unmount()
  })
  const figees = montes.map((m) => m.lectures())
  await new Promise((fin) => setTimeout(fin, 3 * PERIODE_MS))
  const apres = montes.map((m) => m.lectures())
  montes.length = 0
  expect(apres).toEqual(figees)
})

const etat = (branch: string) => ({ available: true, state: { branch } })

describe('badge de branche — il suit la branche REELLE', () => {
  it('affiche la branche au montage', async () => {
    const container = await monter(async () => etat('main'))
    expect(container.textContent).toBe('main')
  })

  it('se met à jour quand le dépôt CHANGE de branche pendant la session', async () => {
    let courante = 'main'
    const container = await monter(async () => etat(courante))
    expect(container.textContent).toBe('main')

    courante = 'chore/route-confidence-threshold-097'
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toBe('chore/route-confidence-threshold-097')
  })

  it('relit périodiquement, sans attendre un focus', async () => {
    vi.useFakeTimers()
    try {
      let courante = 'main'
      const container = await monter(async () => etat(courante))
      courante = 'feat/x'
      await act(async () => {
        vi.advanceTimersByTime(60)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(container.textContent).toBe('feat/x')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reste silencieux quand la lecture échoue — jamais un nom inventé', async () => {
    const container = await monter(async () => {
      throw new Error('git indisponible')
    })
    expect(container.textContent).toBe('')
  })
})
