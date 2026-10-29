// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import { appliquerLangue } from '../langue'
import { CarteDesBesoinsView } from './CarteDesBesoinsView'
import { reclamerOuvertureConversation } from './pending-conversation-open'
import { TestsView } from './TestsView'

/**
 * LES ÉCRANS BOARD ET MAINTENANCE SUIVENT LA LANGUE (traduction anglaise, conv-1170, lot « Board et
 * Maintenance »). Entrée qui doit faire échouer ce test : un libellé du Board (en-tête, rivière,
 * étages, fiche d'un post-it, gestes « vérifier », task d'une demande) ou de Maintenance (onglets,
 * skills d'entretien, suites de tests, panneau Latence) laissé en dur en français, ou un écran qui
 * ne revient pas au français.
 */
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const MAINTENANT = Date.now()
const HEURE = 3_600_000

const demande = (
  conversationId: string,
  statut: StatutDemande,
  debut: number,
  constat: string
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang: 1,
  titre: `demande ${conversationId}`,
  statut,
  constat,
  debut,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
})

function carte(): CarteDesBesoins {
  const demandes = [
    demande('conv-1', 'sans-preuve', MAINTENANT - HEURE, 'fini sans vérification'),
    demande('conv-2', 'prouve', MAINTENANT - 2 * HEURE, 'npm test → exit 0')
  ]
  const comptes = { prouve: 1, refuse: 0, 'en-cours': 0, 'sans-preuve': 1 }
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 2,
    demandes,
    runsBloques: [],
    comptes
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 2,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: 2 }],
    demandesJournalisees: 2,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

const montes: Array<{ root: Root; el: HTMLDivElement }> = []

async function monter(element: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  montes.push({ root, el })
  await act(async () => {
    root.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return el
}

afterEach(async () => {
  for (const m of montes.splice(0)) {
    await act(async () => m.root.unmount())
    m.el.remove()
  }
  reclamerOuvertureConversation()
  appliquerLangue('fr')
})

const texte = (el: HTMLElement, testid: string): string =>
  el.querySelector(`[data-testid="${testid}"]`)?.textContent ?? ''

describe('Board — langue', () => {
  it('passe en anglais sans être remonté, fiche comprise, puis revient au français', async () => {
    ;(window as unknown as { api: unknown }).api = {
      carteDesBesoins: vi.fn(async () => carte()),
      appCommand: vi.fn(async () => ({ ok: true }))
    }
    const el = await monter(
      createElement(CarteDesBesoinsView, { active: true, onOpenConversation: vi.fn() })
    )
    const vue = (): string => el.querySelector('[data-testid="besoins-view"]')?.textContent ?? ''
    expect(vue()).toContain('La rivière')
    expect(texte(el, 'besoins-actualiser')).toBe('Actualiser')

    await act(async () => appliquerLangue('en'))
    // La phrase d'en-tête (« Your threads placed on the day of their last request… ») n'est plus
    // vérifiée : l'utilisateur l'a fait retirer de l'écran (conv-1209, « supprime cette ligne »).
    expect(vue()).toContain('The river')
    expect(texte(el, 'besoins-stats')).toContain('2 requests')
    expect(texte(el, 'besoins-actualiser')).toBe('Refresh')
    // La ligne de compte (« threads over the last 14 days… ») a été retirée (conv-1226) : la
    // fenêtre ne se dit plus que dans l'aria-label de la rivière.
    expect(el.querySelector('[data-testid="riviere"]')?.getAttribute('aria-label')).toBe(
      'The river, the last 14 days'
    )
    expect(texte(el, 'riviere-tout-verifier')).toBe('Check all · 1')
    const etages = [...el.querySelectorAll('[data-testid="riviere-etage"]')].map(
      (e) => e.textContent
    )
    expect(etages).toContain('To check · 1')
    expect(etages).toContain('Done · 1')

    // La fiche d'un post-it « À vérifier » : ses gestes, sa task, son bouton d'ouverture.
    const postit = el.querySelector('[data-conversation="conv-1"]') as HTMLElement
    await act(async () => postit.click())
    expect(texte(el, 'riviere-fiche-ouvrir')).toBe('Open the thread')
    expect(texte(el, 'tache-sans')).toBe('no task')
    expect(texte(el, 'riviere-verif-fiche')).toContain('Checked by hand')
    expect(el.querySelector('[data-testid="riviere-fiche-demande"]')?.getAttribute('title')).toBe(
      'finished without a check'
    )

    await act(async () => appliquerLangue('fr'))
    expect(texte(el, 'besoins-actualiser')).toBe('Actualiser')
    expect(texte(el, 'riviere-fiche-ouvrir')).toBe('Ouvrir le fil')
    expect(el.querySelector('[data-testid="riviere"]')?.getAttribute('aria-label')).toBe(
      'La rivière, les 14 derniers jours'
    )
    expect(el.querySelector('[data-testid="riviere-fiche-demande"]')?.getAttribute('title')).toBe(
      'fini sans vérification'
    )
  })
})

describe('Maintenance — langue', () => {
  it('onglets, skills, suites et Latence en anglais, puis retour au français', async () => {
    ;(window as unknown as { api: unknown }).api = {
      testProjects: vi.fn(async () => [
        {
          id: 'c:/dev/autowin',
          label: 'Autowin OS',
          root: 'C:/dev/autowin',
          runner: 'vitest',
          runnable: true
        }
      ]),
      runProjectTests: vi.fn(async () => ({
        root: 'C:/dev/autowin',
        runner: 'vitest',
        exitCode: 1,
        durationMs: 12,
        totals: { passed: 1, failed: 1, skipped: 0, total: 2 },
        report: {
          cases: [
            { file: 'a.test.ts', name: 'marche', status: 'passed', durationMs: 3 },
            { file: 'a.test.ts', name: 'casse', status: 'failed', error: 'a.test.ts:4 boom' }
          ]
        }
      }))
    }
    const el = await monter(createElement(TestsView, { active: true }))
    const vue = (): string => el.querySelector('[data-testid="tests-view"]')?.textContent ?? ''
    expect(vue()).toContain('Tests unitaires')

    await act(async () => appliquerLangue('en'))
    expect(vue()).toContain('Unit tests')
    expect(vue()).toContain('Latency')
    expect(vue()).toContain('Failures only')
    expect(texte(el, 'maintenance-skill-maintenance')).toContain('Health report')
    expect(vue()).toContain('Troubleshooting')
    expect(vue()).toContain('No run for this project.')

    const lancer = el.querySelector('[data-testid="tests-run"]') as HTMLButtonElement
    expect(lancer.textContent).toBe('Run the suite')
    await act(async () => {
      lancer.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(texte(el, 'tests-totals')).toContain('1 passed')
    expect(texte(el, 'tests-totals')).toContain('1 failures')
    expect(vue()).toContain('Copy the error')

    // L'onglet Latence : sans canal de mesure, l'erreur est dite en anglais.
    const latence = [...el.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes('Latency')
    ) as HTMLButtonElement
    await act(async () => latence.click())
    expect(texte(el, 'perf-refresh')).toBe('Reread the log')
    expect(texte(el, 'perf-panel')).toContain('perf:turnLatency channel unavailable')

    await act(async () => appliquerLangue('fr'))
    expect(texte(el, 'perf-refresh')).toBe('Relire le journal')
    expect(vue()).toContain('Tests unitaires')
    expect(texte(el, 'maintenance-skill-maintenance')).toContain('Bulletin de santé')
  })
})
