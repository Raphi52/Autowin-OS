// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { PerfLagPanel } from './PerfLagPanel'

/**
 * conv-1077 (2026-10-22) : trois `electron.exe` pesaient ~872, 433 et 307 Mo et l'app ne disait
 * pas lequel est quoi. Le relevé (`releve-memoire.ts`) doit être LU dans l'onglet Latence.
 * fix-ok: rouge mesuré 2026-10-22 — aucune section « perf-memoire » ; relevé lu dans `gels.memoire` car un canal à part portait à 236 le compte de security-critical-fixes.test.ts.
 */
const jalonsVides = {
  tours: 0,
  lignesIllisibles: 0,
  segments: [],
  suspects: [],
  disponible: false,
  source: 'C:/data/turn-timing.jsonl'
}

const releve = {
  dernier: {
    ts: '2026-10-22T12:00:00.000Z',
    totalMo: 1612,
    processus: [
      { pid: 12, type: 'Tab', memoireMo: 872, cpuPct: 14.3 },
      { pid: 10, type: 'GPU', memoireMo: 433, cpuPct: 2.5 },
      { pid: 11, type: 'Browser', memoireMo: 307, cpuPct: 1 }
    ]
  },
  picTotalMo: 1700,
  echantillons: 12,
  periodeMs: 60000
}

const gelsVides = {
  gels: 0,
  pireMs: 0,
  cumulMs: 0,
  parOperation: [],
  lignesIllisibles: 0,
  demarrages: 1,
  gelsNonImputables: 0,
  msNonImputables: 0,
  disponible: true,
  source: 'C:/data/gels.jsonl'
}

// Le relevé arrive JOINT à la réponse de `perf:gels` : aucun canal IPC de plus.
async function rendre(memoire?: unknown, avecGels = true): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = {
    perfTurnLatency: async () => jalonsVides,
    ...(avecGels
      ? { perfGels: async () => ({ ...gelsVides, ...(memoire ? { memoire } : {}) }) }
      : {})
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PerfLagPanel))
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
  return container
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  document.body.innerHTML = ''
})

describe('mémoire et processeur dans l’onglet Latence (conv-1077)', () => {
  it('nomme le rôle de chaque processus avec ses Mo et son CPU, plus le total et le pic', async () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si le relevé n'était pas affiché : un relevé à trois
    // processus (Tab 872 Mo, GPU 433 Mo, Browser 307 Mo).
    const container = await rendre(releve)
    const section = container.querySelector('[data-testid="perf-memoire"]')
    expect(section?.textContent).toContain('1612 Mo')
    expect(section?.textContent).toContain('1700 Mo')
    const lignes = [...container.querySelectorAll('[data-testid="perf-memoire-processus"]')].map(
      (l) => l.textContent
    )
    expect(lignes).toHaveLength(3)
    expect(lignes[0]).toContain('Fenêtre')
    expect(lignes[0]).toContain('872 Mo')
    expect(lignes[0]).toContain('14.3 %')
    expect(lignes[1]).toContain('GPU')
    expect(lignes[2]).toContain('Processus principal')
  })

  it('jumeau : sans canal, moteur d’avant (rien de joint) ou aucun relevé encore : aucune section', async () => {
    const sansCanal = await rendre(releve, false)
    expect(sansCanal.querySelector('[data-testid="perf-memoire"]')).toBeNull()
    document.body.innerHTML = ''
    const ancienMoteur = await rendre()
    expect(ancienMoteur.querySelector('[data-testid="perf-memoire"]')).toBeNull()
    document.body.innerHTML = ''
    const sansReleve = await rendre({ picTotalMo: 0, echantillons: 0, periodeMs: 60000 })
    expect(sansReleve.querySelector('[data-testid="perf-memoire"]')).toBeNull()
  })
})
