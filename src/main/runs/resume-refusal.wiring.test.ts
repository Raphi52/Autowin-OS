import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifierRefusDeReprise, type RefusDeReprise } from './resume-refusal'

/**
 * Le classificateur ne sert à RIEN s'il n'est pas câblé sur l'oubli du checkpoint : c'est
 * `os.forgetResumableOrchestration` qui tarit la source du bandeau ⛔ rejoué à chaque boot.
 *
 * POURQUOI UNE ASSERTION SUR LA SOURCE et pas un espion runtime : le `catch` vit au milieu de
 * `src/main/index.ts`, module Electron monolithique (>6000 lignes, `app`/`BrowserWindow` au
 * chargement) qu'aucun test n'importe. Extraire le handler serait un refactor hors périmètre.
 * Ce test reste DISCRIMINANT : retirer l'appel d'une branche, ou ajouter une classe de refus
 * définitif sans la câbler, le fait rougir. Sa limite est déclarée — il prouve le CÂBLAGE, pas
 * l'exécution.
 */
const INDEX = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

function corpsDuCatchDeReprise(): string {
  const debut = INDEX.indexOf('const refus = classifierRefusDeReprise(message)')
  expect(debut).toBeGreaterThan(-1)
  const fin = INDEX.indexOf('await bus.observeOutcomeLearning(', debut)
  expect(fin).toBeGreaterThan(debut)
  return INDEX.slice(debut, fin)
}

describe('câblage du refus définitif sur l’oubli du checkpoint', () => {
  const corps = corpsDuCatchDeReprise()
  const branches = corps.split(/if \(refus === /).slice(1)

  it('le catch de reprise possède bien des branches de refus classé', () => {
    expect(branches.length).toBeGreaterThanOrEqual(2)
  })

  it.each(branches.map((b, i) => [i, b] as const))(
    'la branche %i oublie le checkpoint',
    (_i, branche) => {
      expect(branche).toContain('os.forgetResumableOrchestration(resumableRun.runId)')
    }
  )

  it('chaque classe de refus définitif est câblée dans le catch', () => {
    const classes: RefusDeReprise[] = [
      'publication-acquise',
      'copie-durable-absente',
      'contexte-de-reprise-invalide'
    ]
    for (const classe of classes) {
      expect(corps).toContain(`refus === '${classe}'`)
    }
  })

  it('les classes câblées sont exactement celles que le classificateur produit', () => {
    const produites = new Set(
      [
        'Reprise du worktree refusée pour run-x : publication complete déjà engagée.',
        'Reprise du worktree impossible pour run-x : copie durable absente ou incomplète.',
        'Reprise du worktree refusée : Le SHA de départ durable est invalide.'
      ].map((m) => classifierRefusDeReprise(m))
    )
    expect(produites).toEqual(
      new Set<RefusDeReprise>([
        'publication-acquise',
        'copie-durable-absente',
        'contexte-de-reprise-invalide'
      ])
    )
  })
})
