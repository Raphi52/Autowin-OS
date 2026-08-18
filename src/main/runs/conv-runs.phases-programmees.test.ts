import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConvRun } from './conv-runs'
import { parseRun } from '../dashboards/runs'
import { rootDodLabels, rootExecutionRequirements } from '../root-execution-contract'

/**
 * UNE OBLIGATION SE CROISE AVEC LES PHASES REELLEMENT PROGRAMMEES.
 *
 * Defaut vecu le 2026-08-18 : une demande limitee a la phase FRAME a rendu un livrable complet, et
 * l'application a affiche « Workflow BLOQUE par le gate — livrable non valide · statut failed »
 * avec « DoD 0/1 ». Cause : `rootExecutionRequirements(task)` derivait mutation/tests/commit du
 * SEUL texte de la demande, sans savoir quelles phases le run allait jouer. Un run limite a `frame`
 * ne produit aucun code : il ne peut ni prouver une mutation, ni committer. L'exigence etait
 * structurellement insatisfaisable — le run etait condamne avant de commencer.
 *
 * LA REGRESSION QUI MENACE N'EST PAS « ca n'exige plus rien ici », C'EST « ca n'exige plus rien
 * nulle part » : desarmer le gate en croyant le corriger. D'ou le test SYMETRIQUE ci-dessous, qui
 * verifie qu'un programme comportant `build` exige TOUJOURS mutation, tests et commit.
 */
describe('contrat racine — croise avec les phases programmees', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-convruns-phases-'))
  const DEMANDE = 'Traite ce candidat : corrige le bug, lance les tests et publie un commit.'

  it('SANS phases, le contrat est INCHANGE (appelants non migres)', () => {
    expect(rootExecutionRequirements(DEMANDE)).toMatchObject({
      mutation: true,
      tests: true,
      commit: true
    })
    expect(rootDodLabels(DEMANDE)).toHaveLength(3)
  })

  it.each([[['frame']], [['scout']], [['terrain']], [['scout', 'frame', 'terrain']]])(
    'un programme sans phase d ecriture n exige ni mutation, ni tests, ni commit : %s',
    (phases) => {
      expect(rootExecutionRequirements(DEMANDE, phases)).toMatchObject({
        mutation: false,
        tests: false,
        commit: false
      })
    }
  )

  it("conserve l'obligation d'ANALYSE d'un run de lecture : elle, il peut la tenir", () => {
    const requis = rootExecutionRequirements('Scout les defauts puis corrige-les et commit.', [
      'scout'
    ])
    expect(requis.analysis).toBe(true)
    expect(requis.mutation).toBe(false)
  })

  it('LE TEST SYMETRIQUE — un programme AVEC build exige TOUJOURS tout', () => {
    for (const phases of [['build'], ['frame', 'build'], ['scout', 'frame', 'terrain', 'build']]) {
      expect(rootExecutionRequirements(DEMANDE, phases)).toMatchObject({
        mutation: true,
        tests: true,
        commit: true
      })
      expect(rootDodLabels(DEMANDE, phases)).toContain(
        'Commit demande publie avec une identite Git verifiable'
      )
    }
  })

  it('createConvRun ne seme aucune case non cochable pour un run limite a frame', () => {
    const chemin = createConvRun('conv-frame', DEMANDE, racine(), () => 0, ['frame'])
    const md = readFileSync(chemin, 'utf8')
    expect(md).not.toContain('Mutation demandee')
    expect(md).not.toContain('Commit demande')
    expect(parseRun(md).dodTotal).toBe(0)
  })

  it('createConvRun seme TOUJOURS les cases quand build est au programme — symetrie', () => {
    const chemin = createConvRun('conv-build', DEMANDE, racine(), () => 0, ['frame', 'build'])
    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('- [ ] Mutation demandee produite avec une preuve executable')
    expect(md).toContain('- [ ] Commit demande publie avec une identite Git verifiable')
    expect(parseRun(md).dodTotal).toBeGreaterThanOrEqual(3)
  })
})
