import { describe, expect, it } from 'vitest'
import {
  groupOutcomeSummary,
  orchestrationOutcomesFromMessages,
  orchestrateOutcomeSummary,
  verifyOutcomeSummary
} from './action-outcome-summary'

/**
 * La PREUVE doit être lisible dans le fil.
 *
 * Constaté sur conv-76 (2026-07-29) : `verify` appelé trois fois, et le fil n'affichait que
 * « 1 action terminée verify ». L'exit code — la seule chose qui prouve — restait invisible.
 */
describe('verifyOutcomeSummary — le verdict est lisible', () => {
  it('succès : la commande et son exit code', () => {
    expect(
      verifyOutcomeSummary({
        name: 'verify',
        ok: true,
        data: { command: 'npm test', exitCode: 0, ok: true }
      })
    ).toEqual({ label: 'npm test → exit 0', state: 'ok' })
  })

  it('ÉCHEC : l’exit code non nul est rendu visible', () => {
    expect(
      verifyOutcomeSummary({
        name: 'verify',
        ok: true,
        data: { command: 'npm test', exitCode: 1, ok: false }
      })
    ).toEqual({ label: 'npm test → exit 1', state: 'failed' })
  })

  it('REFUS : dit pourquoi rien n’a été lancé', () => {
    const summary = verifyOutcomeSummary({
      name: 'verify',
      data: { allowed: false, reason: 'le projet ne déclare aucun script « test »' }
    })
    expect(summary?.state).toBe('refused')
    expect(summary?.label).toContain('aucun script')
  })

  it('lancement impossible : pas d’exit code, mais ce n’est PAS un succès', () => {
    const summary = verifyOutcomeSummary({
      name: 'verify',
      data: { command: 'npm test', exitCode: null, ok: false, output: 'lancement impossible' }
    })
    expect(summary?.state).toBe('failed')
    expect(summary?.label).toContain('aucun code de sortie')
  })

  it('une AUTRE action ne produit aucun résumé (aucune régression visuelle)', () => {
    expect(
      verifyOutcomeSummary({ name: 'edit_file', ok: true, data: { path: 'a.ts' } })
    ).toBeUndefined()
    expect(verifyOutcomeSummary({ name: 'orchestrate', ok: true, data: {} })).toBeUndefined()
  })

  it('résultat pas encore arrivé → rien à afficher', () => {
    expect(verifyOutcomeSummary({ name: 'verify' })).toBeUndefined()
    expect(verifyOutcomeSummary({ name: 'verify', data: 'texte libre' })).toBeUndefined()
  })
})

describe('groupOutcomeSummary — l’ÉCHEC passe devant', () => {
  it('privilégie une vérification échouée sur une réussie', () => {
    const summary = groupOutcomeSummary([
      { name: 'verify', data: { command: 'npm test', exitCode: 0, ok: true } },
      { name: 'edit_file', data: {} },
      { name: 'verify', data: { command: 'npm test', exitCode: 2, ok: false } }
    ])
    expect(summary).toEqual({ label: 'npm test → exit 2', state: 'failed' })
  })

  it('privilégie un refus sur une réussie (rien n’a tourné, il faut le savoir)', () => {
    const summary = groupOutcomeSummary([
      { name: 'verify', data: { command: 'npm test', exitCode: 0, ok: true } },
      { name: 'verify', data: { allowed: false, reason: 'aucun workspace résolu' } }
    ])
    expect(summary?.state).toBe('refused')
  })

  it('aucune vérification dans le groupe → aucun résumé', () => {
    expect(groupOutcomeSummary([{ name: 'edit_file', data: {} }])).toBeUndefined()
    expect(groupOutcomeSummary([])).toBeUndefined()
  })
})

describe('orchestrateOutcomeSummary — 92 % de la depense devient visible', () => {
  it('un refus livré en CHAÎNE brute porte quand même sa raison (conv-1178, 14/08)', () => {
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      ok: false,
      data: 'Lancement bloqué : main et origin/main ont divergé ; intègre-les avant de lancer un job.'
    })
    expect(summary?.state).toBe('failed')
    expect(summary?.label).toContain('ont divergé')
  })

  it('succes : statut et cout', () => {
    expect(
      orchestrateOutcomeSummary({
        name: 'orchestrate',
        data: { status: 'succeeded', costUsd: 10.05 }
      })
    ).toEqual({ label: 'succeeded · 10,05 $', state: 'ok' })
  })

  it('gate BLOQUE = echec de livraison, pas un detail', () => {
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: { status: 'failed', gateBlocked: true, costUsd: 3 }
    })
    expect(summary).toEqual({ label: 'bloqué par le gate · 3,00 $', state: 'failed' })
  })

  it('livrable REFUSE par le juge = echec, meme si l’appel a reussi', () => {
    expect(
      orchestrateOutcomeSummary({
        name: 'orchestrate',
        data: { status: 'succeeded', valid: false }
      })?.state
    ).toBe('failed')
  })

  it('orchestration qui JETTE remonte SA raison, pas un generique « livrable refusé »', () => {
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: { status: 'failed', valid: false, error: 'ENOENT: worktree introuvable' }
    })
    // La cause reelle est visible dans le fil (fin de la frustration « erreur » opaque).
    expect(summary).toEqual({ label: 'échec : ENOENT: worktree introuvable', state: 'failed' })
  })

  it('raison longue tronquee pour ne pas casser la ligne du fil', () => {
    const long = 'x'.repeat(200)
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: { status: 'failed', valid: false, error: long }
    })
    expect(summary?.label.startsWith('échec : ')).toBe(true)
    expect(summary?.label.endsWith('…')).toBe(true)
    expect(summary!.label.length).toBeLessThan(140)
  })

  it('un valid:false SANS error reste « livrable refusé » (refus propre du juge, pas un echec dur)', () => {
    expect(
      orchestrateOutcomeSummary({
        name: 'orchestrate',
        data: { status: 'succeeded', valid: false }
      })?.label
    ).toBe('livrable refusé')
  })

  it('run REUTILISE est signale (aucun nouveau travail lance)', () => {
    expect(orchestrateOutcomeSummary({ name: 'orchestrate', data: { reused: true } })?.state).toBe(
      'refused'
    )
  })

  it('cout de mauvais type ignore au lieu d’etre affiche', () => {
    expect(
      orchestrateOutcomeSummary({
        name: 'orchestrate',
        data: { status: 'succeeded', costUsd: 'cher' }
      })?.label
    ).toBe('succeeded')
  })

  it('coût inconnu : affiche la couverture, jamais un faux 0.00 $', () => {
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: { status: 'succeeded', costUsd: 0, knownCostUsd: null, unpricedCalls: 3 }
    })
    expect(summary?.label).toContain('coût non exposé')
    expect(summary?.label).toContain('3 appels non chiffrés')
    expect(summary?.label).not.toContain('0.00 $')
  })

  it('un coût non tarifé mais MESURÉ devient une estimation, pas « coût non exposé »', () => {
    // Le volume est compté par le superviseur ; seul le tarif manquait. Cf. `cost-estimate.ts`.
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: {
        status: 'succeeded',
        knownCostUsd: null,
        unpricedCalls: 3,
        inputTokens: 2_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 1_500_000,
        pricingModel: 'claude-opus-5'
      }
    })
    expect(summary?.label).toContain('estimés')
    expect(summary?.label).not.toContain('coût non exposé')
    expect(summary?.label).toContain('3 appels non chiffrés')
  })

  it('modèle inconnu : affiche le VOLUME plutôt qu’un montant inventé', () => {
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: {
        status: 'succeeded',
        knownCostUsd: null,
        unpricedCalls: 2,
        totalTokens: 2_100_000,
        pricingModel: 'un-modele-maison'
      }
    })
    expect(summary?.label).toContain('2.1M tokens')
    expect(summary?.label).toContain('tarif non exposé')
    expect(summary?.label).not.toContain('$')
  })

  it('un gate bloqué NOMME son motif : le coût qui suit n’est pas la cause', () => {
    // Défaut vécu (`dev-sans-watch.test.ts`) : la pastille ne disait que « bloqué par le gate ·
    // coût non exposé », et la mention comptable a été prise pour le motif du blocage.
    const summary = orchestrateOutcomeSummary({
      name: 'orchestrate',
      data: {
        status: 'failed',
        gateBlocked: true,
        gateReasons: ['DoD non cochée', 'signal non rejoué'],
        knownCostUsd: null,
        unpricedCalls: 3
      }
    })
    expect(summary?.label).toContain('DoD non cochée')
    expect(summary?.label.indexOf('DoD non cochée')).toBeLessThan(
      summary!.label.indexOf('non chiffrés')
    )
    expect(summary?.state).toBe('failed')
  })

  it('un gate bloqué SANS motif rapporté reste lisible', () => {
    expect(
      orchestrateOutcomeSummary({
        name: 'orchestrate',
        data: { status: 'failed', gateBlocked: true, gateReasons: [], costUsd: 3 }
      })
    ).toEqual({ label: 'bloqué par le gate · 3,00 $', state: 'failed' })
  })

  it('une autre action ne produit rien', () => {
    expect(orchestrateOutcomeSummary({ name: 'verify', data: {} })).toBeUndefined()
  })
})

describe('groupOutcomeSummary — verify ET orchestrate', () => {
  it('un gate bloque passe devant une verification reussie', () => {
    const summary = groupOutcomeSummary([
      { name: 'verify', data: { command: 'npm test', exitCode: 0, ok: true } },
      { name: 'orchestrate', data: { gateBlocked: true, costUsd: 8 } }
    ])
    expect(summary?.state).toBe('failed')
    expect(summary?.label).toContain('gate')
  })
})

/**
 * Contrat de CABLAGE : le resume doit etre REELLEMENT affiche, sinon il reste un module mort et la
 * preuve continue d'etre cachee (le defaut d'origine).
 */
describe('cablage — le verdict est rendu dans le bloc d’activite', () => {
  const parts = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'ChatView.parts.tsx'), 'utf8')
  }

  it('appelle le resume et rend son libelle', () => {
    const source = parts()
    expect(source).toContain('groupOutcomeSummary(actions)')
    expect(source).toContain('data-testid="activity-outcome"')
    expect(source).toContain('{outcome.label}')
  })

  it('colore selon le verdict (un echec doit se voir)', () => {
    expect(parts()).toContain('st-${outcome.state}')
  })

  it('n’affiche RIEN sans resume (aucune regression visuelle)', () => {
    expect(parts()).toContain('{outcome && (')
  })
})

/**
 * ÉTAT TERMINAL — un échec REPRIS n'est plus le verdict du groupe.
 *
 * Défaut vécu (conv-1302, 2026-08-18) : le résumé retenait le PREMIER échec du groupe. Un tour
 * qui échouait puis se reprenait avec succès s'affichait « échec », si bien que l'utilisateur
 * relançait une demande déjà satisfaite. Ce qui compte est l'état TERMINAL de chaque action, pas
 * le premier incident rencontré en route.
 *
 * La règle ne blanchit rien : deux actions DIFFÉRENTES gardent leurs verdicts respectifs, et
 * l'échec d'une vérification reste prioritaire face au succès d'une orchestration.
 */
describe('groupOutcomeSummary — l’état terminal prime sur un incident repris', () => {
  const orchestrate = (data: Record<string, unknown>): { name: string; data: unknown } => ({
    name: 'orchestrate',
    data
  })

  it('une orchestration échouée PUIS reprise avec succès rend le succès terminal', () => {
    const summary = groupOutcomeSummary([
      orchestrate({ gateBlocked: true, gateReasons: ['statut red'] }),
      orchestrate({ status: 'succeeded', valid: true })
    ])
    expect(summary).toMatchObject({ state: 'ok' })
    expect(summary?.label).toContain('succeeded')
  })

  it('un échec NON repris reste le verdict du groupe', () => {
    expect(
      groupOutcomeSummary([
        orchestrate({ status: 'succeeded', valid: true }),
        orchestrate({ gateBlocked: true, gateReasons: ['statut red'] })
      ])
    ).toMatchObject({ state: 'failed' })
  })

  it('l’échec d’une AUTRE action n’est pas effacé par le succès d’une orchestration', () => {
    expect(
      groupOutcomeSummary([
        { name: 'verify', data: { command: 'npm test', exitCode: 1, ok: false } },
        orchestrate({ status: 'succeeded', valid: true })
      ])
    ).toMatchObject({ state: 'failed', label: 'npm test → exit 1' })
  })
})

/**
 * MATIÈRE PREMIÈRE de la friction sur échecs répétés : les issues d'orchestration du fil, dans
 * l'ordre. Lecture duck-typée — un fil relu du disque n'offre aucune garantie de forme.
 */
describe('orchestrationOutcomesFromMessages', () => {
  const msg = (parts: unknown[]): unknown => ({ role: 'assistant', parts })
  const action = (name: string, data: unknown): unknown => ({ kind: 'action', name, data })

  it('rend les issues orchestrate dans l’ordre du fil', () => {
    const outcomes = orchestrationOutcomesFromMessages([
      { role: 'user', content: 'go' },
      msg([action('orchestrate', { status: 'failed' })]),
      msg([action('verify', { exitCode: 0 }), action('orchestrate', { status: 'succeeded' })])
    ])
    expect(outcomes).toEqual([{ status: 'failed' }, { status: 'succeeded' }])
  })

  it('ignore sans jeter tout ce qui n’est pas une issue exploitable', () => {
    expect(
      orchestrationOutcomesFromMessages([
        null,
        undefined,
        { role: 'assistant' },
        { role: 'assistant', parts: 'pas un tableau' },
        msg([null, 'texte', action('orchestrate', 'chaîne brute'), { kind: 'text', text: 'x' }])
      ])
    ).toEqual([])
  })
})
