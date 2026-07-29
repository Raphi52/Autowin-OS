import { describe, expect, it } from 'vitest'
import { groupOutcomeSummary, verifyOutcomeSummary } from './action-outcome-summary'

/**
 * La PREUVE doit être lisible dans le fil.
 *
 * Constaté sur conv-76 (2026-07-29) : `verify` appelé trois fois, et le fil n'affichait que
 * « 1 action terminée verify ». L'exit code — la seule chose qui prouve — restait invisible.
 */
describe('verifyOutcomeSummary — le verdict est lisible', () => {
  it('succès : la commande et son exit code', () => {
    expect(
      verifyOutcomeSummary({ name: 'verify', ok: true, data: { command: 'npm test', exitCode: 0, ok: true } })
    ).toEqual({ label: 'npm test → exit 0', state: 'ok' })
  })

  it('ÉCHEC : l’exit code non nul est rendu visible', () => {
    expect(
      verifyOutcomeSummary({ name: 'verify', ok: true, data: { command: 'npm test', exitCode: 1, ok: false } })
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
    expect(verifyOutcomeSummary({ name: 'edit_file', ok: true, data: { path: 'a.ts' } })).toBeUndefined()
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
