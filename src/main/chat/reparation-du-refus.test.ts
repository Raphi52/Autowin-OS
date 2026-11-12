import { describe, expect, it, vi } from 'vitest'
import { estUneRepriseAutomatique } from './relance-taches-de-fond'
import {
  SUITE_QUAND_LA_PORTE_RETENTE_SEULE,
  composerPromptDeReparation,
  decisionDeReparation,
  estUneReparationDuRefus,
  lancerLaReparationDuRefus
} from './reparation-du-refus'

const DETAIL =
  'Commit refusé : ce qui est commité porte un nom ou un terme d’entreprise (src/a.test.ts (contenu)). Retirer le nom ou le terme, puis relancer.'

const refusDeLaPorte = (detail?: string): unknown => ({
  runId: 'conv-1 · tour abcdef12',
  project: { status: 'skipped', reason: 'porte-refusee', ...(detail ? { detail } : {}) }
})

const tour = (
  plus: Partial<Parameters<typeof decisionDeReparation>[0]> = {}
): Parameters<typeof decisionDeReparation>[0] => ({
  rapport: refusDeLaPorte(DETAIL),
  demande: 'corrige le lanceur',
  deFond: false,
  lotDePlan: false,
  filOccupe: false,
  ...plus
})

describe('réparation lancée par l’app après un refus de la porte', () => {
  it('lance un tour qui porte la raison réelle du refus, signé par Autowin', () => {
    const decision = decisionDeReparation(tour())
    expect(decision.lancer).toBe(true)
    if (!decision.lancer) return
    expect(decision.prompt).toContain(DETAIL)
    // Écrit par l'app, pas par l'utilisateur : les contrôles et l'interface le reconnaissent à cet en-tête.
    expect(estUneRepriseAutomatique(decision.prompt)).toBe(true)
    expect(estUneReparationDuRefus(decision.prompt)).toBe(true)
    // Le tour ne publie pas lui-même : l'app refait l'entrée à sa fin.
    expect(decision.prompt).toMatch(/Ne commite pas/u)
  })

  it('un refus sans détail lance quand même le tour, qui devra retrouver la cause', () => {
    const decision = decisionDeReparation(tour({ rapport: refusDeLaPorte() }))
    expect(decision.lancer).toBe(true)
    if (decision.lancer) expect(decision.prompt).toMatch(/non précisée/u)
  })

  it('une seule réparation par demande : un refus du tour de réparation revient à l’utilisateur', () => {
    const reparation = composerPromptDeReparation(DETAIL)
    expect(decisionDeReparation(tour({ demande: reparation }))).toEqual({
      lancer: false,
      raison: 'deja-tentee'
    })
  })

  it('ne lance rien quand la porte réessaie seule', () => {
    const rapport = refusDeLaPorte(
      `Modifié et non commité dans le dossier partagé : src/a.ts. Rien n’y a été écrit ; la copie reste. ${SUITE_QUAND_LA_PORTE_RETENTE_SEULE}`
    )
    expect(decisionDeReparation(tour({ rapport }))).toEqual({
      lancer: false,
      raison: 'retente-seule'
    })
  })

  it.each([
    ['un envoi parti', { project: { status: 'committed', files: 2 } }],
    ['un autre refus', { project: { status: 'skipped', reason: 'tests-rouges' } }],
    ['une attente', { project: { status: 'skipped', reason: 'porte-en-attente' } }],
    ['aucun rapport', undefined]
  ])('ne lance rien pour %s', (_nom, rapport) => {
    expect(decisionDeReparation(tour({ rapport }))).toEqual({
      lancer: false,
      raison: 'pas-un-refus-de-la-porte'
    })
  })

  it.each([
    ['tour-de-fond', { deFond: true }],
    ['lot-de-plan', { lotDePlan: true }],
    ['fil-occupe', { filOccupe: true }]
  ] as const)('ne lance rien : %s', (raison, plus) => {
    expect(decisionDeReparation(tour(plus))).toEqual({ lancer: false, raison })
  })
})

describe('lancerLaReparationDuRefus', () => {
  it('envoie le tour dans le fil du refus', async () => {
    const envoyerTour = vi.fn().mockResolvedValue({ ok: true })
    const lance = lancerLaReparationDuRefus(
      { envoyerTour, journal: vi.fn() },
      { ...tour(), conversationId: 'conv-1' }
    )
    expect(lance).toBe(true)
    expect(envoyerTour).toHaveBeenCalledTimes(1)
    expect(envoyerTour.mock.calls[0]?.[0]).toBe('conv-1')
    expect(envoyerTour.mock.calls[0]?.[1]).toContain(DETAIL)
  })

  it('n’envoie rien quand la décision est non', () => {
    const envoyerTour = vi.fn()
    const lance = lancerLaReparationDuRefus(
      { envoyerTour, journal: vi.fn() },
      { ...tour({ filOccupe: true }), conversationId: 'conv-1' }
    )
    expect(lance).toBe(false)
    expect(envoyerTour).not.toHaveBeenCalled()
  })

  it('un tour en échec ou un envoi qui lève va au journal, sans jamais lever', async () => {
    const journal = vi.fn()
    lancerLaReparationDuRefus(
      { envoyerTour: vi.fn().mockRejectedValue(new Error('coupé')), journal },
      { ...tour(), conversationId: 'conv-1' }
    )
    lancerLaReparationDuRefus(
      { envoyerTour: vi.fn().mockResolvedValue({ ok: false, error: 'quota' }), journal },
      { ...tour(), conversationId: 'conv-2' }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(journal).toHaveBeenCalledTimes(2)
  })
})
